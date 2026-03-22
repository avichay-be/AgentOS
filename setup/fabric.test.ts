import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { upsertEnvVars } from './env-file.js';
import { _internals } from './fabric.js';

describe('fabric setup args', () => {
  it('uses quick-setup defaults', () => {
    const parsed = _internals.parseArgs([]);
    expect(parsed.appName).toBe('agentos');
    expect(parsed.createSecret).toBe(true);
    expect(parsed.installSkill).toBe(true);
    expect(parsed.grantViewer).toBe(true);
  });

  it('accepts workspace name and opt-out flags', () => {
    const parsed = _internals.parseArgs([
      '--workspace-name',
      'Fabric Prod ws',
      '--app-name',
      'agentos-fabric',
      '--no-create-secret',
      '--no-install-skill',
      '--no-grant-viewer',
    ]);

    expect(parsed.workspaceName).toBe('Fabric Prod ws');
    expect(parsed.appName).toBe('agentos-fabric');
    expect(parsed.createSecret).toBe(false);
    expect(parsed.installSkill).toBe(false);
    expect(parsed.grantViewer).toBe(false);
  });
});

describe('env upsert', () => {
  it('appends and updates env keys without dropping existing lines', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-env-'));
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'EXISTING=value\nAZURE_CLIENT_ID="old"\n');

    upsertEnvVars(envPath, {
      AZURE_CLIENT_ID: 'new-client',
      FABRIC_WORKSPACE_ID: 'workspace-123',
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXISTING=value');
    expect(content).toContain('AZURE_CLIENT_ID="new-client"');
    expect(content).toContain('FABRIC_WORKSPACE_ID="workspace-123"');
  });
});
