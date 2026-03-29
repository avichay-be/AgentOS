import { randomUUID } from 'crypto';
import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';

import { WebChannel } from '../channels/web.js';
import { getRegisteredChannelNames } from '../channels/registry.js';
import {
  deleteTask,
  getAllChats,
  getAllTasks,
  getAllWebWorkspaces,
  getMessageAttachment,
  getOwnedWebWorkspaces,
  getMessagesForChat,
  getTaskById,
  getTaskRunLogs,
  getWebWorkspaceByJid,
  touchWebWorkspaceLastOpenedAt,
  updateTask,
} from '../db.js';
import {
  WEB_ALLOWED_ORIGINS,
  WEB_HOST,
  WEB_INTERNAL_API_TOKEN,
  WEB_PORT,
} from '../config.js';
import { GroupQueue } from '../group-queue.js';
import { getRecentLogs, logger } from '../logger.js';
import { Channel, RegisteredGroup, WebWorkspaceIdentity } from '../types.js';
import {
  getPublishedDashboard,
  getPublishedDashboardHtml,
  listPublishedDashboards,
  publishLatestDashboard,
} from './dashboards.js';
import { getFrontendCss, getFrontendHtml, getFrontendJs } from './frontend.js';
import {
  createWebWorkspaceChat,
  ensureWebWorkspace,
  normalizeWorkspaceRole,
} from './workspaces.js';
import {
  resolveAttachmentAbsolutePath,
  saveUploadedFiles,
  UploadedFileLike,
} from './uploads.js';

interface WebServerContext {
  channels: Channel[];
  queue: GroupQueue;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  getLastAgentTimestamp: () => Record<string, string>;
  syncGroups: (force: boolean) => Promise<void>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
}

type IncomingMultipartFile = Blob &
  UploadedFileLike & {
    name: string;
  };

function inferChannelFromJid(jid: string): string {
  if (jid.startsWith('tg:')) return 'telegram';
  if (jid.startsWith('dc:')) return 'discord';
  if (jid.startsWith('slack:')) return 'slack';
  if (jid.startsWith('web:')) return 'web';
  if (jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net'))
    return 'whatsapp';
  return 'unknown';
}

function clampLimit(raw: string | null, fallback: number, max: number): number {
  const parsed = raw ? parseInt(raw, 10) : fallback;
  if (!parsed || Number.isNaN(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, max));
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  corsOrigin?: string,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, X-AgentOS-Internal-Token';
    headers.Vary = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function writeText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function toRequestHeaders(
  headers: IncomingMessage['headers'],
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.join(', ');
    }
  }
  return normalized;
}

function isIncomingMultipartFile(
  entry: unknown,
): entry is IncomingMultipartFile {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'name' in entry &&
    'size' in entry &&
    'arrayBuffer' in entry &&
    typeof (entry as { name?: unknown }).name === 'string' &&
    typeof (entry as { size?: unknown }).size === 'number' &&
    typeof (entry as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

async function readFormData(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks);
  const request = new Request('http://localhost/internal-upload', {
    method: req.method || 'POST',
    headers: toRequestHeaders(req.headers),
    body,
  });
  return request.formData();
}

function writeBinary(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

async function parseIncomingWorkspaceMessage(req: IncomingMessage): Promise<{
  text: string;
  senderId: string;
  senderName: string;
  messageId: string;
  files: UploadedFileLike[];
}> {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await readFormData(req);
    const senderId = String(form.get('senderId') || '').trim();
    const senderName = String(form.get('senderName') || '').trim();
    const text = String(form.get('text') || '').trim();
    const providedMessageId = String(form.get('messageId') || '').trim();
    const files = form
      .getAll('files')
      .filter((entry) =>
        isIncomingMultipartFile(entry),
      ) as IncomingMultipartFile[];

    return {
      text,
      senderId,
      senderName,
      messageId: providedMessageId || `web-in-${randomUUID()}`,
      files,
    };
  }

  const body = (await readJsonBody(req)) as {
    text?: string;
    senderId?: string;
    senderName?: string;
    messageId?: string;
  };
  return {
    text: body.text?.trim() || '',
    senderId: body.senderId?.trim() || '',
    senderName: body.senderName?.trim() || '',
    messageId: body.messageId?.trim() || `web-in-${randomUUID()}`,
    files: [],
  };
}

async function handleIncomingWorkspaceMessage(
  context: WebServerContext,
  workspace: WebWorkspaceIdentity,
  incoming: Awaited<ReturnType<typeof parseIncomingWorkspaceMessage>>,
): Promise<ReturnType<WebChannel['receiveMessage']>> {
  const webChannel = findWebChannel(context.channels);
  if (!webChannel) {
    throw new Error('Web channel not available');
  }

  const attachments = await saveUploadedFiles({
    groupFolder: workspace.folder,
    chatJid: workspace.jid,
    messageId: incoming.messageId,
    files: incoming.files,
  });

  const message = webChannel.receiveMessage({
    jid: workspace.jid,
    senderId: incoming.senderId,
    senderName: incoming.senderName,
    chatName: workspace.title,
    text: incoming.text,
    messageId: incoming.messageId,
    attachments,
  });

  touchWebWorkspaceLastOpenedAt(workspace.jid, message.timestamp);
  return message;
}

function getAllowedCorsOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (!origin) return undefined;
  return WEB_ALLOWED_ORIGINS.includes(origin) ? origin : undefined;
}

function findWebChannel(channels: Channel[]): WebChannel | null {
  const channel = channels.find((entry) => entry.name === 'web');
  return channel instanceof WebChannel ? channel : null;
}

function buildChannels(context: WebServerContext) {
  const connectedChannels = new Map(
    context.channels.map((channel) => [channel.name, channel]),
  );

  return getRegisteredChannelNames().map((name) => {
    const channel = connectedChannels.get(name);
    return {
      name,
      installed: true,
      connected: channel !== undefined,
      healthy: channel?.isConnected() ?? false,
    };
  });
}

function buildGroups(context: WebServerContext) {
  const chats = getAllChats().filter((chat) => chat.jid !== '__group_sync__');
  const chatsByJid = new Map(chats.map((chat) => [chat.jid, chat]));
  const groups = context.getRegisteredGroups();
  const sessions = context.getSessions();
  const runtimeByGroup = new Map(
    context.queue.getSnapshot().groups.map((group) => [group.groupJid, group]),
  );
  const taskCountsByChat = new Map<string, number>();

  for (const task of getAllTasks()) {
    taskCountsByChat.set(
      task.chat_jid,
      (taskCountsByChat.get(task.chat_jid) || 0) + 1,
    );
  }

  const allJids = new Set<string>([
    ...chats.map((chat) => chat.jid),
    ...Object.keys(groups),
  ]);

  return [...allJids]
    .map((jid) => {
      const chat = chatsByJid.get(jid);
      const group = groups[jid];
      const sessionId = group ? sessions[group.folder] : undefined;
      const runtime = runtimeByGroup.get(jid) || null;

      return {
        jid,
        name: group?.name || chat?.name || jid,
        channel: chat?.channel || inferChannelFromJid(jid),
        folder: group?.folder || null,
        registered: Boolean(group),
        isMain: group?.isMain === true,
        requiresTrigger: group?.requiresTrigger !== false,
        hasSession: Boolean(sessionId),
        sessionId: sessionId || null,
        taskCount: taskCountsByChat.get(jid) || 0,
        lastActivity: chat?.last_message_time || null,
        runtime,
      };
    })
    .sort((a, b) => {
      const left = a.lastActivity || '';
      const right = b.lastActivity || '';
      return right.localeCompare(left);
    });
}

function buildTasks(context: WebServerContext) {
  const groups = context.getRegisteredGroups();
  return getAllTasks().map((task) => ({
    ...task,
    groupName: groups[task.chat_jid]?.name || task.group_folder,
  }));
}

function buildOverview(context: WebServerContext) {
  const channels = buildChannels(context);
  const groups = buildGroups(context);
  const tasks = getAllTasks();
  const queue = context.queue.getSnapshot();
  const logs = getRecentLogs(100);

  return {
    channels: {
      installed: channels.length,
      connected: channels.filter((channel) => channel.connected).length,
    },
    groups: {
      knownChats: getAllChats().filter((chat) => chat.jid !== '__group_sync__')
        .length,
      groups: getAllChats().filter(
        (chat) => chat.jid !== '__group_sync__' && chat.is_group === 1,
      ).length,
      registered: groups.filter((group) => group.registered).length,
    },
    tasks: {
      total: tasks.length,
      active: tasks.filter((task) => task.status === 'active').length,
      paused: tasks.filter((task) => task.status === 'paused').length,
      completed: tasks.filter((task) => task.status === 'completed').length,
    },
    runtime: {
      activeCount: queue.activeCount,
      maxConcurrent: queue.maxConcurrent,
      waitingGroups: queue.waitingGroups.length,
    },
    logs: {
      total: logs.length,
      errorCount: logs.filter(
        (entry) => entry.level === 'error' || entry.level === 'fatal',
      ).length,
    },
  };
}

function buildWorkspaceSummary(
  context: WebServerContext,
  workspace: WebWorkspaceIdentity,
) {
  const groups = context.getRegisteredGroups();
  const group = groups[workspace.jid];
  const sessions = context.getSessions();
  const taskCount = getAllTasks().filter(
    (task) => task.chat_jid === workspace.jid,
  ).length;
  const runtime = context.queue.getGroupSnapshot(workspace.jid);
  const dashboards = listPublishedDashboards(workspace.folder);

  return {
    ...workspace,
    registered: Boolean(group),
    sessionId: group ? sessions[group.folder] || null : null,
    taskCount,
    dashboardCount: dashboards.length,
    runtime,
  };
}

function buildWorkspaceDetail(
  context: WebServerContext,
  jid: string,
): Record<string, unknown> | null {
  const workspace = getWebWorkspaceByJid(jid);
  if (!workspace) return null;

  const group = context.getRegisteredGroups()[jid] || null;
  const sessionId = group ? context.getSessions()[group.folder] : undefined;

  return {
    workspace: buildWorkspaceSummary(context, workspace),
    group,
    runtime: context.queue.getGroupSnapshot(jid),
    sessionId: sessionId || null,
    lastAgentTimestamp: context.getLastAgentTimestamp()[jid] || null,
    messages: getMessagesForChat(jid, 100),
    tasks: getAllTasks().filter((task) => task.chat_jid === jid),
    dashboards: listPublishedDashboards(workspace.folder),
  };
}

function requireInternalToken(
  req: IncomingMessage,
  res: ServerResponse,
  corsOrigin?: string,
): boolean {
  if (!WEB_INTERNAL_API_TOKEN) return true;
  const token = req.headers['x-agentos-internal-token'];
  if (token === WEB_INTERNAL_API_TOKEN) return true;
  writeJson(res, 401, { error: 'Missing internal token' }, corsOrigin);
  return false;
}

function getDashboardHtmlHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      'img-src data: https: http:',
      'font-src data: https: http:',
      'media-src data: https: http:',
      "connect-src 'none'",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
      'sandbox',
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

async function handleWorkspaceEventStream(
  req: IncomingMessage,
  res: ServerResponse,
  context: WebServerContext,
  jid: string,
  corsOrigin?: string,
): Promise<void> {
  const workspace = getWebWorkspaceByJid(jid);
  const webChannel = findWebChannel(context.channels);
  if (!workspace || !webChannel) {
    writeJson(res, 404, { error: 'Workspace not found' }, corsOrigin);
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  res.writeHead(200, headers);
  res.write(': connected\n\n');

  const unsubscribe = webChannel.subscribe(jid, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: WebServerContext,
): Promise<void> {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`,
  );
  const path = url.pathname;
  const corsOrigin = getAllowedCorsOrigin(req);

  if (req.method === 'OPTIONS') {
    if (!corsOrigin) {
      writeJson(res, 403, { error: 'Origin not allowed' });
      return;
    }
    writeJson(res, 204, {}, corsOrigin);
    return;
  }

  if (
    path.startsWith('/api/internal/') &&
    !requireInternalToken(req, res, corsOrigin)
  ) {
    return;
  }

  if (req.method === 'GET' && path === '/api/health') {
    writeJson(
      res,
      200,
      {
        status: 'ok',
        port: WEB_PORT,
        host: WEB_HOST,
        timestamp: new Date().toISOString(),
        allowedOrigins: WEB_ALLOWED_ORIGINS,
      },
      corsOrigin,
    );
    return;
  }

  if (req.method === 'GET' && path === '/api/overview') {
    writeJson(res, 200, buildOverview(context), corsOrigin);
    return;
  }

  if (req.method === 'GET' && path === '/api/channels') {
    writeJson(res, 200, { channels: buildChannels(context) }, corsOrigin);
    return;
  }

  if (req.method === 'POST' && path === '/api/channels/sync-groups') {
    await context.syncGroups(true);
    writeJson(res, 200, { ok: true }, corsOrigin);
    return;
  }

  if (req.method === 'GET' && path === '/api/groups') {
    writeJson(res, 200, { groups: buildGroups(context) }, corsOrigin);
    return;
  }

  if (req.method === 'GET' && path.startsWith('/api/groups/')) {
    const segments = path.split('/').filter(Boolean);
    const jid = decodeURIComponent(segments[2] || '');

    if (!jid) {
      writeJson(res, 400, { error: 'Missing group jid' }, corsOrigin);
      return;
    }

    if (segments.length === 3) {
      const groups = context.getRegisteredGroups();
      const group = groups[jid];
      const chat = getAllChats().find((entry) => entry.jid === jid);
      const messages = getMessagesForChat(jid, 50);
      const tasks = getAllTasks().filter((task) => task.chat_jid === jid);
      const sessionId = group ? context.getSessions()[group.folder] : undefined;

      writeJson(
        res,
        200,
        {
          jid,
          chat: chat || null,
          group: group || null,
          runtime: context.queue.getGroupSnapshot(jid),
          sessionId: sessionId || null,
          lastAgentTimestamp: context.getLastAgentTimestamp()[jid] || null,
          messages,
          tasks,
        },
        corsOrigin,
      );
      return;
    }

    if (segments[3] === 'messages') {
      const before = url.searchParams.get('before') || undefined;
      const limit = clampLimit(url.searchParams.get('limit'), 100, 500);
      writeJson(
        res,
        200,
        {
          messages: getMessagesForChat(jid, limit, before),
        },
        corsOrigin,
      );
      return;
    }

    if (segments[3] === 'runtime') {
      writeJson(
        res,
        200,
        {
          runtime: context.queue.getGroupSnapshot(jid),
          lastAgentTimestamp: context.getLastAgentTimestamp()[jid] || null,
        },
        corsOrigin,
      );
      return;
    }
  }

  if (req.method === 'GET' && path === '/api/tasks') {
    writeJson(res, 200, { tasks: buildTasks(context) }, corsOrigin);
    return;
  }

  if (path.startsWith('/api/tasks/')) {
    const segments = path.split('/').filter(Boolean);
    const taskId = decodeURIComponent(segments[2] || '');

    if (!taskId) {
      writeJson(res, 400, { error: 'Missing task id' }, corsOrigin);
      return;
    }

    if (req.method === 'GET' && segments.length === 3) {
      const task = getTaskById(taskId);
      if (!task) {
        writeJson(res, 404, { error: 'Task not found' }, corsOrigin);
        return;
      }
      writeJson(res, 200, { task }, corsOrigin);
      return;
    }

    if (req.method === 'GET' && segments[3] === 'runs') {
      writeJson(res, 200, { runs: getTaskRunLogs(taskId) }, corsOrigin);
      return;
    }

    if (req.method === 'POST' && segments[3] === 'pause') {
      updateTask(taskId, { status: 'paused' });
      writeJson(res, 200, { ok: true }, corsOrigin);
      return;
    }

    if (req.method === 'POST' && segments[3] === 'resume') {
      updateTask(taskId, { status: 'active' });
      writeJson(res, 200, { ok: true }, corsOrigin);
      return;
    }

    if (req.method === 'DELETE' && segments[3] === 'delete') {
      deleteTask(taskId);
      writeJson(res, 200, { ok: true }, corsOrigin);
      return;
    }
  }

  if (req.method === 'GET' && path === '/api/runtime') {
    writeJson(
      res,
      200,
      {
        queue: context.queue.getSnapshot(),
        sessions: context.getSessions(),
        lastAgentTimestamp: context.getLastAgentTimestamp(),
      },
      corsOrigin,
    );
    return;
  }

  if (req.method === 'GET' && path === '/api/logs') {
    const limit = clampLimit(url.searchParams.get('limit'), 100, 500);
    writeJson(res, 200, { logs: getRecentLogs(limit) }, corsOrigin);
    return;
  }

  if (req.method === 'GET' && path === '/api/workspaces') {
    const workspaces = getAllWebWorkspaces().map((workspace) =>
      buildWorkspaceSummary(context, workspace),
    );
    writeJson(res, 200, { workspaces }, corsOrigin);
    return;
  }

  if (path.startsWith('/api/workspaces/')) {
    const segments = path.split('/').filter(Boolean);
    const jid = decodeURIComponent(segments[2] || '');
    if (!jid) {
      writeJson(res, 400, { error: 'Missing workspace jid' }, corsOrigin);
      return;
    }

    if (req.method === 'GET' && segments.length === 3) {
      const detail = buildWorkspaceDetail(context, jid);
      if (!detail) {
        writeJson(res, 404, { error: 'Workspace not found' }, corsOrigin);
        return;
      }
      writeJson(res, 200, detail, corsOrigin);
      return;
    }

    if (req.method === 'GET' && segments[3] === 'dashboards') {
      const workspace = getWebWorkspaceByJid(jid);
      if (!workspace) {
        writeJson(res, 404, { error: 'Workspace not found' }, corsOrigin);
        return;
      }

      if (segments.length === 4) {
        writeJson(
          res,
          200,
          { dashboards: listPublishedDashboards(workspace.folder) },
          corsOrigin,
        );
        return;
      }

      const slug = decodeURIComponent(segments[4] || '');
      if (segments[5] === 'content') {
        try {
          const dashboard = getPublishedDashboard(workspace.folder, slug);
          if (!dashboard || dashboard.kind !== 'html') {
            writeJson(
              res,
              404,
              { error: 'Dashboard HTML not found' },
              corsOrigin,
            );
            return;
          }

          const html = getPublishedDashboardHtml(workspace.folder, slug);
          if (!html) {
            writeJson(
              res,
              404,
              { error: 'Dashboard HTML not found' },
              corsOrigin,
            );
            return;
          }

          writeText(
            res,
            200,
            html,
            'text/html; charset=utf-8',
            getDashboardHtmlHeaders(),
          );
        } catch (error) {
          logger.warn({ error, slug }, 'Failed to serve dashboard HTML');
          writeJson(
            res,
            400,
            { error: 'Dashboard HTML is invalid' },
            corsOrigin,
          );
        }
        return;
      }

      try {
        const dashboard = getPublishedDashboard(workspace.folder, slug);
        if (!dashboard) {
          writeJson(res, 404, { error: 'Dashboard not found' }, corsOrigin);
          return;
        }
        writeJson(res, 200, { dashboard }, corsOrigin);
      } catch (error) {
        logger.warn({ error, slug }, 'Failed to read dashboard artifact');
        writeJson(
          res,
          400,
          { error: 'Dashboard artifact is invalid' },
          corsOrigin,
        );
      }
      return;
    }

    if (req.method === 'GET' && segments[3] === 'events') {
      await handleWorkspaceEventStream(req, res, context, jid, corsOrigin);
      return;
    }
  }

  if (req.method === 'POST' && path === '/api/internal/workspaces/ensure') {
    const body = (await readJsonBody(req)) as Partial<WebWorkspaceIdentity>;
    if (!body.tenantId || !body.userId || !body.displayName) {
      writeJson(
        res,
        400,
        { error: 'Missing workspace identity fields' },
        corsOrigin,
      );
      return;
    }

    const workspace = ensureWebWorkspace(
      {
        tenantId: body.tenantId,
        userId: body.userId,
        displayName: body.displayName,
        email: body.email,
        role: normalizeWorkspaceRole(body.role),
      },
      {
        getRegisteredGroups: context.getRegisteredGroups,
        registerGroup: context.registerGroup,
      },
    );
    writeJson(res, 200, { workspace }, corsOrigin);
    return;
  }

  if (req.method === 'GET' && path === '/api/internal/workspaces') {
    const tenantId = url.searchParams.get('tenantId')?.trim() || '';
    const userId = url.searchParams.get('userId')?.trim() || '';
    if (!tenantId || !userId) {
      writeJson(
        res,
        400,
        { error: 'tenantId and userId are required' },
        corsOrigin,
      );
      return;
    }

    writeJson(
      res,
      200,
      {
        workspaces: getOwnedWebWorkspaces(tenantId, userId),
      },
      corsOrigin,
    );
    return;
  }

  if (req.method === 'POST' && path === '/api/internal/workspaces') {
    const body = (await readJsonBody(req)) as Partial<WebWorkspaceIdentity>;
    if (!body.tenantId || !body.userId || !body.displayName) {
      writeJson(
        res,
        400,
        { error: 'Missing workspace identity fields' },
        corsOrigin,
      );
      return;
    }

    const workspace = createWebWorkspaceChat(
      {
        tenantId: body.tenantId,
        userId: body.userId,
        displayName: body.displayName,
        email: body.email,
        role: normalizeWorkspaceRole(body.role),
        title: body.title,
        chatId: body.chatId,
      },
      {
        getRegisteredGroups: context.getRegisteredGroups,
        registerGroup: context.registerGroup,
      },
    );
    writeJson(res, 200, { workspace }, corsOrigin);
    return;
  }

  if (path.startsWith('/api/internal/workspaces/')) {
    const segments = path.split('/').filter(Boolean);
    const jid = decodeURIComponent(segments[3] || '');
    if (!jid) {
      writeJson(res, 400, { error: 'Missing workspace jid' }, corsOrigin);
      return;
    }

    const workspace = getWebWorkspaceByJid(jid);
    if (!workspace) {
      writeJson(res, 404, { error: 'Workspace not found' }, corsOrigin);
      return;
    }

    if (req.method === 'POST' && segments[4] === 'open') {
      touchWebWorkspaceLastOpenedAt(jid);
      writeJson(res, 200, { ok: true }, corsOrigin);
      return;
    }

    if (req.method === 'POST' && segments[4] === 'messages') {
      try {
        const incoming = await parseIncomingWorkspaceMessage(req);
        if (!incoming.senderId || !incoming.senderName) {
          writeJson(
            res,
            400,
            { error: 'senderId and senderName are required' },
            corsOrigin,
          );
          return;
        }
        if (!incoming.text && incoming.files.length === 0) {
          writeJson(
            res,
            400,
            { error: 'Message text or files are required' },
            corsOrigin,
          );
          return;
        }

        const message = await handleIncomingWorkspaceMessage(
          context,
          workspace,
          incoming,
        );
        writeJson(res, 200, { ok: true, message }, corsOrigin);
      } catch (error) {
        writeJson(
          res,
          400,
          {
            error:
              error instanceof Error
                ? error.message
                : 'Invalid message payload',
          },
          corsOrigin,
        );
      }
      return;
    }

    if (
      req.method === 'POST' &&
      segments[4] === 'dashboards' &&
      segments[5] === 'publish-latest'
    ) {
      const dashboard = publishLatestDashboard(workspace.folder);
      if (!dashboard) {
        writeJson(res, 404, { error: 'Dashboard draft not found' }, corsOrigin);
        return;
      }

      writeJson(res, 200, { dashboard }, corsOrigin);
      return;
    }

    if (
      req.method === 'GET' &&
      segments[4] === 'attachments' &&
      segments[6] === 'content'
    ) {
      const attachmentId = decodeURIComponent(segments[5] || '');
      const attachment = getMessageAttachment(jid, attachmentId);
      if (!attachment) {
        writeJson(res, 404, { error: 'Attachment not found' }, corsOrigin);
        return;
      }

      const absolutePath = resolveAttachmentAbsolutePath(
        workspace.folder,
        attachment,
      );
      if (!fs.existsSync(absolutePath)) {
        writeJson(
          res,
          404,
          { error: 'Attachment content not found' },
          corsOrigin,
        );
        return;
      }

      writeBinary(
        res,
        200,
        fs.readFileSync(absolutePath),
        attachment.content_type || 'application/octet-stream',
        {
          'Content-Disposition': `attachment; filename="${attachment.original_name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`,
        },
      );
      return;
    }
  }

  if (req.method === 'POST' && path === '/api/internal/web/messages') {
    const body = (await readJsonBody(req)) as {
      jid?: string;
      senderId?: string;
      senderName?: string;
      text?: string;
      messageId?: string;
    };
    if (!body.jid || !body.senderId || !body.senderName || !body.text) {
      writeJson(res, 400, { error: 'Missing message fields' }, corsOrigin);
      return;
    }

    const workspace = getWebWorkspaceByJid(body.jid);
    if (!workspace) {
      writeJson(res, 404, { error: 'Web workspace not found' }, corsOrigin);
      return;
    }

    const message = await handleIncomingWorkspaceMessage(context, workspace, {
      text: body.text,
      senderId: body.senderId,
      senderName: body.senderName,
      messageId: body.messageId || `web-in-${randomUUID()}`,
      files: [],
    });

    writeJson(res, 200, { ok: true, message }, corsOrigin);
    return;
  }

  writeJson(res, 404, { error: 'Not found' }, corsOrigin);
}

export async function startWebServer(context: WebServerContext): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(
        req.url || '/',
        `http://${req.headers.host || 'localhost'}`,
      ).pathname;

      if (path.startsWith('/api/')) {
        await handleApiRequest(req, res, context);
        return;
      }

      if (req.method === 'GET' && path === '/') {
        writeText(res, 200, getFrontendHtml(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && path === '/app.css') {
        writeText(res, 200, getFrontendCss(), 'text/css; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && path === '/app.js') {
        writeText(res, 200, getFrontendJs(), 'text/javascript; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && path === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      writeText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    } catch (err) {
      logger.error({ err }, 'Web server request failed');
      writeJson(res, 500, { error: 'Internal server error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(WEB_PORT, WEB_HOST, () => {
      logger.info(
        { host: WEB_HOST, port: WEB_PORT, allowedOrigins: WEB_ALLOWED_ORIGINS },
        'Web UI listening',
      );
      resolve();
    });
  });
}
