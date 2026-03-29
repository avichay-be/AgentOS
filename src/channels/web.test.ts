import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestDatabase, getMessagesForChat } from '../db.js';
import { WebChannel } from './web.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('WebChannel', () => {
  it('stores outbound messages and emits stream events', async () => {
    const channel = new WebChannel({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });
    await channel.connect();

    const events: string[] = [];
    const unsubscribe = channel.subscribe('web:tenant:user', (event) => {
      if (event.type === 'message') {
        events.push(event.direction || 'unknown');
      }
    });

    await channel.sendMessage('web:tenant:user', 'hello from agent');
    unsubscribe();

    expect(events).toEqual(['outbound']);
    const messages = getMessagesForChat('web:tenant:user');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello from agent');
    expect(Boolean(messages[0].is_bot_message)).toBe(true);
  });

  it('routes inbound browser messages through the standard callbacks', async () => {
    const onMessage = vi.fn();
    const onChatMetadata = vi.fn();
    const channel = new WebChannel({
      onMessage,
      onChatMetadata,
      registeredGroups: () => ({
        'web:tenant:user': {
          name: 'Avi',
          folder: 'web_folder',
          trigger: '@Andy',
          added_at: '2024-01-01T00:00:00.000Z',
          requiresTrigger: false,
        },
      }),
    });

    channel.receiveMessage({
      jid: 'web:tenant:user',
      senderId: 'user-1',
      senderName: 'Avi',
      text: 'hello',
    });

    expect(onChatMetadata).toHaveBeenCalledWith(
      'web:tenant:user',
      expect.any(String),
      'Avi',
      'web',
      true,
    );
    expect(onMessage).toHaveBeenCalledWith(
      'web:tenant:user',
      expect.objectContaining({
        sender: 'user-1',
        sender_name: 'Avi',
        content: 'hello',
      }),
    );
  });
});
