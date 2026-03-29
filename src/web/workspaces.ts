import { createHash, randomUUID } from 'crypto';

import { ASSISTANT_NAME } from '../config.js';
import {
  getOwnedWebWorkspaces,
  getWebWorkspaceByOwnerAndChatId,
  storeChatMetadata,
  touchWebWorkspaceLastOpenedAt,
  updateWebWorkspaceOwnerProfile,
  upsertWebWorkspace,
} from '../db.js';
import {
  RegisteredGroup,
  WebWorkspaceIdentity,
  WebWorkspaceRole,
} from '../types.js';

export const DEFAULT_WEB_CHAT_ID = 'default';
const DEFAULT_WEB_CHAT_TITLE = 'Default chat';

export interface EnsureWorkspaceInput {
  tenantId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: WebWorkspaceRole;
}

export interface CreateWorkspaceInput extends EnsureWorkspaceInput {
  title?: string;
  chatId?: string;
}

export interface EnsureWorkspaceDeps {
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
}

function hashWorkspaceIdentity(
  tenantId: string,
  userId: string,
  chatId: string = DEFAULT_WEB_CHAT_ID,
): string {
  const seed =
    chatId === DEFAULT_WEB_CHAT_ID
      ? `${tenantId}:${userId}`
      : `${tenantId}:${userId}:${chatId}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

function normalizeChatId(chatId: string | undefined): string {
  const trimmed = (chatId || '').trim();
  if (!trimmed) return DEFAULT_WEB_CHAT_ID;
  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function nextTimestampSuffix(): string {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', ' ')
    .replace('Z', ' UTC');
}

function createDefaultTitle(existingTitles: Set<string>): string {
  if (!existingTitles.has('New chat')) return 'New chat';
  return `New chat ${nextTimestampSuffix()}`;
}

function ensureRegisteredWorkspace(
  workspace: WebWorkspaceIdentity,
  deps: EnsureWorkspaceDeps,
): void {
  const registeredGroups = deps.getRegisteredGroups();
  const existingGroup = registeredGroups[workspace.jid];

  deps.registerGroup(workspace.jid, {
    name: workspace.title,
    folder: workspace.folder,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: existingGroup?.added_at || workspace.createdAt,
    requiresTrigger: false,
  });

  storeChatMetadata(
    workspace.jid,
    workspace.lastLoginAt,
    workspace.title,
    'web',
    true,
  );
}

export function createWebWorkspaceJid(
  tenantId: string,
  userId: string,
  chatId: string = DEFAULT_WEB_CHAT_ID,
): string {
  if (chatId === DEFAULT_WEB_CHAT_ID) {
    return `web:${tenantId}:${userId}`;
  }
  return `web:${tenantId}:${userId}:${chatId}`;
}

export function createWebWorkspaceFolder(
  tenantId: string,
  userId: string,
  chatId: string = DEFAULT_WEB_CHAT_ID,
): string {
  return `web_${hashWorkspaceIdentity(tenantId, userId, chatId)}`;
}

export function normalizeWorkspaceRole(
  role: string | undefined,
): WebWorkspaceRole {
  if (role === 'Admin' || role === 'Operator' || role === 'Viewer') return role;
  return 'Viewer';
}

export function ensureWebWorkspace(
  input: EnsureWorkspaceInput,
  deps: EnsureWorkspaceDeps,
): WebWorkspaceIdentity {
  const now = new Date().toISOString();
  updateWebWorkspaceOwnerProfile(input.tenantId, input.userId, {
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    lastLoginAt: now,
  });

  const existingDefault = getWebWorkspaceByOwnerAndChatId(
    input.tenantId,
    input.userId,
    DEFAULT_WEB_CHAT_ID,
  );

  const workspace: WebWorkspaceIdentity = existingDefault
    ? {
        ...existingDefault,
        displayName: input.displayName || existingDefault.displayName,
        email: input.email || existingDefault.email,
        role: input.role,
        title: existingDefault.title || DEFAULT_WEB_CHAT_TITLE,
        lastLoginAt: now,
      }
    : {
        tenantId: input.tenantId,
        userId: input.userId,
        chatId: DEFAULT_WEB_CHAT_ID,
        jid: createWebWorkspaceJid(input.tenantId, input.userId),
        folder: createWebWorkspaceFolder(input.tenantId, input.userId),
        displayName: input.displayName,
        email: input.email,
        role: input.role,
        title: DEFAULT_WEB_CHAT_TITLE,
        createdAt: now,
        lastLoginAt: now,
        lastOpenedAt: now,
      };

  upsertWebWorkspace(workspace);
  ensureRegisteredWorkspace(workspace, deps);
  return workspace;
}

export function createWebWorkspaceChat(
  input: CreateWorkspaceInput,
  deps: EnsureWorkspaceDeps,
): WebWorkspaceIdentity {
  const now = new Date().toISOString();
  const owned = getOwnedWebWorkspaces(input.tenantId, input.userId);
  const existingTitles = new Set(owned.map((workspace) => workspace.title));

  let chatId = normalizeChatId(input.chatId);
  if (!chatId || chatId === DEFAULT_WEB_CHAT_ID) {
    chatId = `chat-${randomUUID().slice(0, 8)}`;
  }

  const title =
    (input.title || '').trim() || createDefaultTitle(existingTitles);
  const existing = getWebWorkspaceByOwnerAndChatId(
    input.tenantId,
    input.userId,
    chatId,
  );
  if (existing) return existing;

  const workspace: WebWorkspaceIdentity = {
    tenantId: input.tenantId,
    userId: input.userId,
    chatId,
    jid: createWebWorkspaceJid(input.tenantId, input.userId, chatId),
    folder: createWebWorkspaceFolder(input.tenantId, input.userId, chatId),
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    title,
    createdAt: now,
    lastLoginAt: now,
    lastOpenedAt: now,
  };

  upsertWebWorkspace(workspace);
  ensureRegisteredWorkspace(workspace, deps);
  return workspace;
}

export function listOwnedWebWorkspaces(
  tenantId: string,
  userId: string,
): WebWorkspaceIdentity[] {
  return getOwnedWebWorkspaces(tenantId, userId);
}

export function markWebWorkspaceOpened(jid: string): void {
  touchWebWorkspaceLastOpenedAt(jid);
}
