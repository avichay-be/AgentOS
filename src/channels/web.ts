import { randomUUID } from 'crypto';

import { ASSISTANT_NAME } from '../config.js';
import { storeChatMetadata, storeMessageDirect } from '../db.js';
import { logger } from '../logger.js';
import {
  Channel,
  MessageAttachment,
  NewMessage,
  WebChatStreamEvent,
} from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

export type WebChannelSubscriber = (event: WebChatStreamEvent) => void;

export class WebChannel implements Channel {
  name = 'web';

  private connected = false;
  private readonly opts: ChannelOpts;
  private readonly subscribers = new Map<string, Set<WebChannelSubscriber>>();

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.connected = true;
    logger.info('Web channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const message: NewMessage = {
      id: `web-out-${randomUUID()}`,
      chat_jid: jid,
      sender: 'agentos:web',
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp,
      is_from_me: true,
      is_bot_message: true,
    };

    storeChatMetadata(jid, timestamp, undefined, 'web', true);
    storeMessageDirect({
      ...message,
      is_from_me: true,
      is_bot_message: true,
    });
    this.publish(jid, {
      type: 'message',
      timestamp,
      direction: 'outbound',
      message,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscribers.clear();
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    this.publish(jid, {
      type: 'typing',
      timestamp: new Date().toISOString(),
      isTyping,
    });
  }

  receiveMessage(params: {
    jid: string;
    senderId: string;
    senderName: string;
    chatName?: string;
    text: string;
    messageId?: string;
    attachments?: MessageAttachment[];
  }): NewMessage {
    const timestamp = new Date().toISOString();
    const message: NewMessage = {
      id: params.messageId || `web-in-${randomUUID()}`,
      chat_jid: params.jid,
      sender: params.senderId,
      sender_name: params.senderName,
      content: params.text,
      timestamp,
      is_from_me: false,
      attachments: params.attachments,
    };

    this.opts.onChatMetadata(
      params.jid,
      timestamp,
      params.chatName || params.senderName,
      'web',
      true,
    );
    this.opts.onMessage(params.jid, message);
    this.publish(params.jid, {
      type: 'message',
      timestamp,
      direction: 'inbound',
      message,
    });

    return message;
  }

  subscribe(jid: string, subscriber: WebChannelSubscriber): () => void {
    const listeners = this.subscribers.get(jid) || new Set<WebChannelSubscriber>();
    listeners.add(subscriber);
    this.subscribers.set(jid, listeners);

    return () => {
      const current = this.subscribers.get(jid);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.subscribers.delete(jid);
    };
  }

  private publish(jid: string, event: WebChatStreamEvent): void {
    const listeners = this.subscribers.get(jid);
    if (!listeners || listeners.size === 0) return;

    for (const subscriber of listeners) {
      try {
        subscriber(event);
      } catch (err) {
        logger.warn({ jid, err }, 'Web channel subscriber failed');
      }
    }
  }
}

registerChannel('web', (opts: ChannelOpts) => new WebChannel(opts));
