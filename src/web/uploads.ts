import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from '../group-folder.js';
import { MessageAttachment } from '../types.js';

export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

export interface UploadedFileLike {
  name: string;
  type?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file');
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'file';
}

function assertAllowedFile(file: UploadedFileLike): string {
  const safeName = sanitizeFilename(file.name);
  const ext = path.extname(safeName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${safeName}`);
  }
  if (file.size <= 0) {
    throw new Error(`File is empty: ${safeName}`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds 10 MB: ${safeName}`);
  }

  return safeName;
}

function workspaceUploadDir(groupFolder: string): string {
  return path.join(resolveGroupFolderPath(groupFolder), 'uploads');
}

export function resolveAttachmentAbsolutePath(
  groupFolder: string,
  attachment: MessageAttachment,
): string {
  return path.resolve(
    resolveGroupFolderPath(groupFolder),
    attachment.relative_path,
  );
}

export function buildAttachmentPromptBlock(
  attachments: MessageAttachment[],
): string {
  if (attachments.length === 0) return '';

  const lines = attachments.map((attachment) => {
    const containerPath = path.posix.join(
      '/workspace/group',
      attachment.relative_path.replace(/\\/g, '/'),
    );
    return `- ${attachment.original_name} | ${attachment.content_type} | ${attachment.size_bytes} bytes | ${containerPath}`;
  });

  return ['[ATTACHED FILES]', ...lines].join('\n');
}

export async function saveUploadedFiles(params: {
  groupFolder: string;
  chatJid: string;
  messageId: string;
  files: UploadedFileLike[];
}): Promise<MessageAttachment[]> {
  const { groupFolder, chatJid, messageId, files } = params;

  if (files.length === 0) return [];
  if (files.length > MAX_FILES_PER_MESSAGE) {
    throw new Error(
      `Too many files. Max ${MAX_FILES_PER_MESSAGE} attachments.`,
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new Error('Total upload size exceeds 25 MB.');
  }

  const uploadDir = workspaceUploadDir(groupFolder);
  fs.mkdirSync(uploadDir, { recursive: true });

  const attachments: MessageAttachment[] = [];
  for (const file of files) {
    const safeName = assertAllowedFile(file);
    const attachmentId = randomUUID();
    const storedName = `${attachmentId}-${safeName}`;
    const relativePath = path.join('uploads', storedName);
    const absolutePath = path.join(uploadDir, storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absolutePath, buffer);

    attachments.push({
      id: attachmentId,
      message_id: messageId,
      chat_jid: chatJid,
      original_name: safeName,
      stored_name: storedName,
      content_type: file.type || 'application/octet-stream',
      size_bytes: buffer.byteLength,
      relative_path: relativePath,
      created_at: new Date().toISOString(),
    });
  }

  return attachments;
}
