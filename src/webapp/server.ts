import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { Readable } from 'stream';

import {
  buildEntraLoginUrl,
  clearOAuthStateCookie,
  clearSessionCookie,
  createBrowserSession,
  createDevUser,
  exchangeEntraCodeForUser,
  getAuthMode,
  getOAuthStateFromRequest,
  getSessionFromRequest,
  setOAuthStateCookie,
  setSessionCookie,
} from './auth.js';
import {
  deleteTaskById,
  ensureWorkspaceForUser,
  getAdminChannels,
  getAdminLogs,
  getAdminOverview,
  getAdminRuntime,
  getAdminTasks,
  getAdminWorkspaces,
  getOwnedWorkspaces,
  getWorkspaceAttachmentContent,
  getWorkspaceDashboard,
  getWorkspaceDashboardContent,
  getWorkspaceDashboards,
  getWorkspaceDetail,
  getWorkspaceEventStream,
  getWorkspaceMessages,
  getWorkspaceRuntime,
  createWorkspaceChat,
  markWorkspaceOpened,
  pauseTask,
  postWorkspaceMessage,
  publishLatestWorkspaceDashboard,
  resumeTask,
  syncGroups,
} from './internal-api.js';
import { WEBAPP_HOST, WEBAPP_PORT } from '../config.js';
import { BrowserSession } from './auth.js';
import { WebWorkspaceIdentity, WebWorkspaceRole } from '../types.js';
import { logger } from '../logger.js';

const FRONTEND_DIST = path.resolve(process.cwd(), 'webui', 'dist');

type IncomingMultipartFile = Blob & {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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

async function readFormData(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const request = new Request('http://localhost/app-upload', {
    method: req.method || 'POST',
    headers: toRequestHeaders(req.headers),
    body: Buffer.concat(chunks),
  });
  return request.formData();
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

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function hasRole(session: BrowserSession, required: WebWorkspaceRole): boolean {
  const rank: Record<WebWorkspaceRole, number> = {
    Viewer: 1,
    Operator: 2,
    Admin: 3,
  };
  return rank[session.role] >= rank[required];
}

function requireSession(
  req: IncomingMessage,
  res: ServerResponse,
): BrowserSession | null {
  const session = getSessionFromRequest(req);
  if (!session) {
    writeJson(res, 401, { error: 'Authentication required' });
    return null;
  }
  return session;
}

function requireRole(
  req: IncomingMessage,
  res: ServerResponse,
  role: WebWorkspaceRole,
): BrowserSession | null {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!hasRole(session, role)) {
    writeJson(res, 403, { error: 'Forbidden' });
    return null;
  }
  return session;
}

function isOwnedWorkspaceJid(session: BrowserSession, jid: string): boolean {
  const base = `web:${session.tenantId}:${session.userId}`;
  return jid === base || jid.startsWith(`${base}:`);
}

async function listOwnedChats(
  session: BrowserSession,
): Promise<WebWorkspaceIdentity[]> {
  return getOwnedWorkspaces({
    tenantId: session.tenantId,
    userId: session.userId,
  });
}

async function resolveOwnedWorkspace(
  session: BrowserSession,
  requestedJid: string | null | undefined,
  res: ServerResponse,
): Promise<WebWorkspaceIdentity | null> {
  const workspaces = await listOwnedChats(session);
  if (workspaces.length === 0) {
    writeJson(res, 404, { error: 'No chats found for this user' });
    return null;
  }

  if (requestedJid) {
    if (!isOwnedWorkspaceJid(session, requestedJid)) {
      writeJson(res, 403, { error: 'Forbidden' });
      return null;
    }

    const workspace = workspaces.find((entry) => entry.jid === requestedJid);
    if (!workspace) {
      writeJson(res, 404, { error: 'Chat not found' });
      return null;
    }
    return workspace;
  }

  return (
    workspaces.find((entry) => entry.chatId === 'default') ||
    workspaces[0] ||
    null
  );
}

async function buildForwardedMessageBody(
  req: IncomingMessage,
  session: BrowserSession,
  res: ServerResponse,
): Promise<{
  body: NonNullable<RequestInit['body']>;
  headers?: RequestInit['headers'];
} | null> {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await readFormData(req);
    const text = String(form.get('text') || '').trim();
    const messageId = String(form.get('messageId') || '').trim();
    const files = form
      .getAll('files')
      .filter((entry) =>
        isIncomingMultipartFile(entry),
      ) as IncomingMultipartFile[];

    if (!text && files.length === 0) {
      writeJson(res, 400, { error: 'Message text or files are required' });
      return null;
    }

    const forwarded = new FormData();
    forwarded.set('senderId', session.userId);
    forwarded.set('senderName', session.displayName);
    if (text) forwarded.set('text', text);
    if (messageId) forwarded.set('messageId', messageId);
    for (const file of files) {
      forwarded.append('files', file, file.name);
    }

    return { body: forwarded };
  }

  const payload = (await readJsonBody(req)) as {
    text?: string;
    messageId?: string;
  };
  if (!payload.text?.trim()) {
    writeJson(res, 400, { error: 'Message text is required' });
    return null;
  }

  return {
    body: JSON.stringify({
      senderId: session.userId,
      senderName: session.displayName,
      text: payload.text.trim(),
      messageId: payload.messageId,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

function getContentType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function serveFrontend(res: ServerResponse, pathname: string): void {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const requested = path.resolve(FRONTEND_DIST, `.${cleanPath}`);
  const insideDist = path.relative(FRONTEND_DIST, requested);
  if (
    !insideDist.startsWith('..') &&
    !path.isAbsolute(insideDist) &&
    fs.existsSync(requested) &&
    fs.statSync(requested).isFile()
  ) {
    writeText(
      res,
      200,
      fs.readFileSync(requested, 'utf8'),
      getContentType(requested),
    );
    return;
  }

  const indexPath = path.join(FRONTEND_DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    writeText(
      res,
      200,
      fs.readFileSync(indexPath, 'utf8'),
      'text/html; charset=utf-8',
    );
    return;
  }

  writeText(
    res,
    503,
    `Tenant web UI is not built yet. Start the frontend dev server with "npm run webui:dev" or build it with "npm run webui:build".`,
    'text/plain; charset=utf-8',
  );
}

async function handleAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/auth/login') {
    if (getAuthMode() === 'dev') {
      const user = createDevUser(url.searchParams);
      await ensureWorkspaceForUser({
        tenantId: user.tenantId,
        userId: user.userId,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      });
      setSessionCookie(res, createBrowserSession(user));
      redirect(res, '/chat');
      return true;
    }

    const { authorizationUrl, state } = buildEntraLoginUrl();
    setOAuthStateCookie(res, state);
    redirect(res, authorizationUrl);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    if (getAuthMode() !== 'entra') {
      redirect(res, '/chat');
      return true;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = getOAuthStateFromRequest(req);
    if (!code || !state || !cookieState || state !== cookieState) {
      writeJson(res, 400, { error: 'Invalid OAuth state' });
      return true;
    }

    const user = await exchangeEntraCodeForUser(code);
    await ensureWorkspaceForUser({
      tenantId: user.tenantId,
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    });
    clearOAuthStateCookie(res);
    setSessionCookie(res, createBrowserSession(user));
    redirect(res, '/chat');
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/auth/logout') {
    clearOAuthStateCookie(res);
    clearSessionCookie(res);
    redirect(res, '/');
    return true;
  }

  return false;
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/app-api/')) return false;

  if (req.method === 'GET' && url.pathname === '/app-api/auth/session') {
    const session = getSessionFromRequest(req);
    writeJson(res, 200, {
      authenticated: Boolean(session),
      authMode: getAuthMode(),
      user: session,
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/chats') {
    const session = requireSession(req, res);
    if (!session) return true;
    writeJson(res, 200, {
      chats: await listOwnedChats(session),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/app-api/chats') {
    const session = requireSession(req, res);
    if (!session) return true;
    const body = (await readJsonBody(req)) as {
      title?: string;
    };
    const workspace = await createWorkspaceChat({
      tenantId: session.tenantId,
      userId: session.userId,
      displayName: session.displayName,
      email: session.email,
      role: session.role,
      title: body.title,
    });
    writeJson(res, 200, { chat: workspace });
    return true;
  }

  if (url.pathname.startsWith('/app-api/chats/')) {
    const segments = url.pathname.split('/').filter(Boolean);
    const jid = decodeURIComponent(segments[2] || '');
    const session = requireSession(req, res);
    if (!session) return true;

    const workspace = await resolveOwnedWorkspace(session, jid, res);
    if (!workspace) return true;

    if (req.method === 'GET' && segments[3] === 'messages') {
      const before = url.searchParams.get('before') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
      await markWorkspaceOpened(workspace.jid);
      writeJson(
        res,
        200,
        await getWorkspaceMessages(workspace.jid, limit, before),
      );
      return true;
    }

    if (req.method === 'POST' && segments[3] === 'messages') {
      const forwarded = await buildForwardedMessageBody(req, session, res);
      if (!forwarded) return true;
      writeJson(
        res,
        200,
        await postWorkspaceMessage({
          jid: workspace.jid,
          body: forwarded.body,
          headers: forwarded.headers,
        }),
      );
      return true;
    }

    if (req.method === 'GET' && segments[3] === 'runtime') {
      writeJson(res, 200, await getWorkspaceRuntime(workspace.jid));
      return true;
    }

    if (req.method === 'GET' && segments[3] === 'events') {
      const upstream = await getWorkspaceEventStream(workspace.jid);
      if (!upstream.ok || !upstream.body) {
        writeJson(res, 502, { error: 'Failed to open workspace event stream' });
        return true;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      const stream = Readable.fromWeb(upstream.body as never);
      stream.pipe(res);
      req.on('close', () => {
        stream.destroy();
      });
      return true;
    }

    if (
      req.method === 'GET' &&
      segments[3] === 'dashboards' &&
      segments.length === 4
    ) {
      writeJson(res, 200, {
        dashboards: await getWorkspaceDashboards(workspace.jid),
      });
      return true;
    }

    if (
      req.method === 'POST' &&
      segments[3] === 'dashboards' &&
      segments[4] === 'publish-latest'
    ) {
      writeJson(res, 200, {
        dashboard: await publishLatestWorkspaceDashboard(workspace.jid),
      });
      return true;
    }

    if (
      req.method === 'GET' &&
      segments[3] === 'dashboards' &&
      segments[5] === 'content'
    ) {
      const slug = decodeURIComponent(segments[4] || '');
      const upstream = await getWorkspaceDashboardContent(workspace.jid, slug);
      const body = await upstream.text();

      writeText(
        res,
        upstream.status,
        body,
        upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
        {
          'Content-Security-Policy':
            upstream.headers.get('content-security-policy') ||
            "default-src 'none'",
          'Referrer-Policy':
            upstream.headers.get('referrer-policy') || 'no-referrer',
          'X-Content-Type-Options':
            upstream.headers.get('x-content-type-options') || 'nosniff',
          'Cross-Origin-Resource-Policy':
            upstream.headers.get('cross-origin-resource-policy') ||
            'same-origin',
        },
      );
      return true;
    }

    if (req.method === 'GET' && segments[3] === 'dashboards' && segments[4]) {
      const slug = decodeURIComponent(segments[4] || '');
      writeJson(res, 200, {
        dashboard: await getWorkspaceDashboard(workspace.jid, slug),
      });
      return true;
    }

    if (
      req.method === 'GET' &&
      segments[3] === 'attachments' &&
      segments[5] === 'content'
    ) {
      const attachmentId = decodeURIComponent(segments[4] || '');
      const upstream = await getWorkspaceAttachmentContent(
        workspace.jid,
        attachmentId,
      );
      const buffer = Buffer.from(await upstream.arrayBuffer());
      writeBinary(
        res,
        upstream.status,
        buffer,
        upstream.headers.get('content-type') || 'application/octet-stream',
        {
          'Content-Disposition':
            upstream.headers.get('content-disposition') || 'attachment',
        },
      );
      return true;
    }
  }

  if (req.method === 'GET' && url.pathname === '/app-api/chat/messages') {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    const before = url.searchParams.get('before') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
    await markWorkspaceOpened(workspace.jid);
    writeJson(
      res,
      200,
      await getWorkspaceMessages(workspace.jid, limit, before),
    );
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/app-api/chat/messages') {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    const forwarded = await buildForwardedMessageBody(req, session, res);
    if (!forwarded) return true;
    writeJson(
      res,
      200,
      await postWorkspaceMessage({
        jid: workspace.jid,
        body: forwarded.body,
        headers: forwarded.headers,
      }),
    );
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/chat/runtime') {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    writeJson(res, 200, await getWorkspaceRuntime(workspace.jid));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/chat/events') {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;

    const upstream = await getWorkspaceEventStream(workspace.jid);
    if (!upstream.ok || !upstream.body) {
      writeJson(res, 502, { error: 'Failed to open workspace event stream' });
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    const stream = Readable.fromWeb(upstream.body as never);
    stream.pipe(res);
    req.on('close', () => {
      stream.destroy();
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/dashboards') {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    writeJson(res, 200, {
      dashboards: await getWorkspaceDashboards(workspace.jid),
    });
    return true;
  }

  if (
    req.method === 'GET' &&
    url.pathname.startsWith('/app-api/dashboards/') &&
    url.pathname.endsWith('/content')
  ) {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    const slug = decodeURIComponent(url.pathname.split('/')[3] || '');
    const upstream = await getWorkspaceDashboardContent(workspace.jid, slug);
    const body = await upstream.text();

    writeText(
      res,
      upstream.status,
      body,
      upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
      {
        'Content-Security-Policy':
          upstream.headers.get('content-security-policy') ||
          "default-src 'none'",
        'Referrer-Policy':
          upstream.headers.get('referrer-policy') || 'no-referrer',
        'X-Content-Type-Options':
          upstream.headers.get('x-content-type-options') || 'nosniff',
        'Cross-Origin-Resource-Policy':
          upstream.headers.get('cross-origin-resource-policy') || 'same-origin',
      },
    );
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/app-api/dashboards/')) {
    const session = requireSession(req, res);
    if (!session) return true;
    const workspace = await resolveOwnedWorkspace(
      session,
      url.searchParams.get('chat'),
      res,
    );
    if (!workspace) return true;
    const slug = decodeURIComponent(url.pathname.split('/')[3] || '');
    writeJson(res, 200, {
      dashboard: await getWorkspaceDashboard(workspace.jid, slug),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/overview') {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await getAdminOverview());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/channels') {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await getAdminChannels());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/runtime') {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await getAdminRuntime());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/tasks') {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await getAdminTasks());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/logs') {
    if (!requireRole(req, res, 'Operator')) return true;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
    writeJson(res, 200, await getAdminLogs(limit));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app-api/admin/workspaces') {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await getAdminWorkspaces());
    return true;
  }

  if (
    req.method === 'GET' &&
    url.pathname.startsWith('/app-api/admin/workspaces/')
  ) {
    if (!requireRole(req, res, 'Operator')) return true;
    const jid = decodeURIComponent(url.pathname.split('/')[4] || '');
    writeJson(res, 200, await getWorkspaceDetail(jid));
    return true;
  }

  if (
    req.method === 'POST' &&
    url.pathname === '/app-api/admin/channels/sync-groups'
  ) {
    if (!requireRole(req, res, 'Operator')) return true;
    writeJson(res, 200, await syncGroups());
    return true;
  }

  if (
    req.method === 'POST' &&
    url.pathname.startsWith('/app-api/admin/tasks/')
  ) {
    const session = requireRole(req, res, 'Operator');
    if (!session) return true;
    const segments = url.pathname.split('/');
    const taskId = decodeURIComponent(segments[4] || '');
    const action = segments[5];
    if (!taskId) {
      writeJson(res, 400, { error: 'Task id is required' });
      return true;
    }
    if (action === 'pause') {
      writeJson(res, 200, await pauseTask(taskId));
      return true;
    }
    if (action === 'resume') {
      writeJson(res, 200, await resumeTask(taskId));
      return true;
    }
  }

  if (
    req.method === 'DELETE' &&
    url.pathname.startsWith('/app-api/admin/tasks/')
  ) {
    const session = requireRole(req, res, 'Admin');
    if (!session) return true;
    const segments = url.pathname.split('/');
    const taskId = decodeURIComponent(segments[4] || '');
    if (!taskId) {
      writeJson(res, 400, { error: 'Task id is required' });
      return true;
    }
    writeJson(res, 200, await deleteTaskById(taskId));
    return true;
  }

  writeJson(res, 404, { error: 'Not found' });
  return true;
}

async function requestHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`,
  );

  if (await handleAuthRoute(req, res, url)) return;
  if (await handleApiRoute(req, res, url)) return;

  if (req.method === 'GET' && url.pathname === '/') {
    redirect(res, '/chat');
    return;
  }

  if (req.method === 'GET') {
    serveFrontend(res, url.pathname);
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
}

export async function startWebAppServer(): Promise<void> {
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      logger.error({ err }, 'Web app request failed');
      writeJson(res, 500, { error: 'Internal server error' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(WEBAPP_PORT, WEBAPP_HOST, () => {
      logger.info(
        { host: WEBAPP_HOST, port: WEBAPP_PORT },
        'Tenant web app listening',
      );
      resolve();
    });
  });
}

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  startWebAppServer().catch((err) => {
    logger.error({ err }, 'Failed to start tenant web app');
    process.exit(1);
  });
}
