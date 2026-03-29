import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  getOwnedWebWorkspaces,
  getWebWorkspaceByIdentity,
} from '../db.js';
import { RegisteredGroup } from '../types.js';
import {
  createWebWorkspaceChat,
  createWebWorkspaceFolder,
  createWebWorkspaceJid,
  ensureWebWorkspace,
} from './workspaces.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('web workspaces', () => {
  it('creates deterministic folder and jid values', () => {
    expect(createWebWorkspaceJid('tenant', 'user')).toBe('web:tenant:user');
    expect(createWebWorkspaceFolder('tenant', 'user')).toBe(
      createWebWorkspaceFolder('tenant', 'user'),
    );
    expect(createWebWorkspaceJid('tenant', 'user', 'chat-1')).toBe(
      'web:tenant:user:chat-1',
    );
  });

  it('provisions and registers a web workspace', () => {
    const registeredGroups: Record<string, RegisteredGroup> = {};
    const registerGroup = vi.fn((jid: string, group: RegisteredGroup) => {
      registeredGroups[jid] = group;
    });

    const workspace = ensureWebWorkspace(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        displayName: 'Avi',
        email: 'avi@example.com',
        role: 'Admin',
      },
      {
        getRegisteredGroups: () => registeredGroups,
        registerGroup,
      },
    );

    expect(registerGroup).toHaveBeenCalledOnce();
    expect(workspace.jid).toBe('web:tenant-1:user-1');
    expect(workspace.folder).toMatch(/^web_[a-f0-9]{24}$/);
    expect(registeredGroups[workspace.jid]).toMatchObject({
      name: 'Default chat',
      folder: workspace.folder,
      requiresTrigger: false,
    });
    expect(getWebWorkspaceByIdentity('tenant-1', 'user-1')).toMatchObject({
      jid: workspace.jid,
      chatId: 'default',
      title: 'Default chat',
      role: 'Admin',
    });
  });

  it('creates additional chats for the same owner', () => {
    const registeredGroups: Record<string, RegisteredGroup> = {};
    const registerGroup = vi.fn((jid: string, group: RegisteredGroup) => {
      registeredGroups[jid] = group;
    });

    ensureWebWorkspace(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        displayName: 'Avi',
        email: 'avi@example.com',
        role: 'Operator',
      },
      {
        getRegisteredGroups: () => registeredGroups,
        registerGroup,
      },
    );

    const secondChat = createWebWorkspaceChat(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        displayName: 'Avi',
        email: 'avi@example.com',
        role: 'Operator',
        chatId: 'planning',
        title: 'Planning',
      },
      {
        getRegisteredGroups: () => registeredGroups,
        registerGroup,
      },
    );

    expect(secondChat.jid).toBe('web:tenant-1:user-1:planning');
    expect(secondChat.title).toBe('Planning');
    expect(registeredGroups[secondChat.jid]).toMatchObject({
      name: 'Planning',
      folder: secondChat.folder,
    });
    expect(getOwnedWebWorkspaces('tenant-1', 'user-1')).toHaveLength(2);
  });
});
