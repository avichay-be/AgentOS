import fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGroupFolderPath } from '../group-folder.js';
import {
  buildAttachmentPromptBlock,
  MAX_FILE_BYTES,
  saveUploadedFiles,
} from './uploads.js';

const createdFolders = new Set<string>();

function createGroupFolder(folder: string): string {
  const groupDir = resolveGroupFolderPath(folder);
  fs.rmSync(groupDir, { recursive: true, force: true });
  fs.mkdirSync(groupDir, { recursive: true });
  createdFolders.add(groupDir);
  return groupDir;
}

function fakeFile(name: string, content: string, type: string) {
  const buffer = Buffer.from(content, 'utf8');
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return {
    name,
    type,
    size: buffer.byteLength,
    async arrayBuffer() {
      return arrayBuffer;
    },
  };
}

afterEach(() => {
  for (const groupDir of createdFolders) {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
  createdFolders.clear();
});

describe('web uploads', () => {
  it('saves sanitized files and builds attachment prompt blocks', async () => {
    const folder = 'web_uploads_ok';
    createGroupFolder(folder);

    const attachments = await saveUploadedFiles({
      groupFolder: folder,
      chatJid: 'web:tenant:user',
      messageId: 'msg-1',
      files: [
        fakeFile('../Quarterly Report.pdf', 'hello pdf', 'application/pdf'),
        fakeFile('image.png', 'pngdata', 'image/png'),
      ],
    });

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      original_name: 'Quarterly-Report.pdf',
      relative_path: expect.stringMatching(/^uploads\//),
    });
    for (const attachment of attachments) {
      expect(
        fs.existsSync(resolveGroupFolderPath(folder) + `/${attachment.relative_path}`),
      ).toBe(true);
    }
    expect(
      buildAttachmentPromptBlock(attachments),
    ).toContain('/workspace/group/uploads/');
  });

  it('rejects unsupported file types and oversized files', async () => {
    const folder = 'web_uploads_invalid';
    createGroupFolder(folder);

    await expect(
      saveUploadedFiles({
        groupFolder: folder,
        chatJid: 'web:tenant:user',
        messageId: 'msg-2',
        files: [fakeFile('malware.exe', 'boom', 'application/octet-stream')],
      }),
    ).rejects.toThrow('Unsupported file type');

    await expect(
      saveUploadedFiles({
        groupFolder: folder,
        chatJid: 'web:tenant:user',
        messageId: 'msg-3',
        files: [
          {
            name: 'large.pdf',
            type: 'application/pdf',
            size: MAX_FILE_BYTES + 1,
            async arrayBuffer() {
              return new ArrayBuffer(MAX_FILE_BYTES + 1);
            },
          },
        ],
      }),
    ).rejects.toThrow('File exceeds 10 MB');
  });
});
