import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import YAML from 'yaml';

import { logger } from '../src/logger.js';
import { initNanoclawDir } from '../skills-engine/init.js';
import { applySkill } from '../skills-engine/apply.js';
import { upsertEnvVars } from './env-file.js';
import { emitStatus } from './status.js';

interface FabricSetupOptions {
  workspaceId?: string;
  workspaceName?: string;
  appName: string;
  clientId?: string;
  createSecret: boolean;
  installSkill: boolean;
  grantViewer: boolean;
}

interface AzureAccount {
  tenantId: string;
}

interface FabricWorkspace {
  id: string;
  name: string;
}

function parseArgs(args: string[]): FabricSetupOptions {
  const opts: FabricSetupOptions = {
    appName: 'agentos',
    createSecret: true,
    installSkill: true,
    grantViewer: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--workspace-id':
        opts.workspaceId = next;
        i += 1;
        break;
      case '--workspace-name':
        opts.workspaceName = next;
        i += 1;
        break;
      case '--app-name':
        opts.appName = next || opts.appName;
        i += 1;
        break;
      case '--client-id':
        opts.clientId = next;
        i += 1;
        break;
      case '--no-create-secret':
        opts.createSecret = false;
        break;
      case '--no-install-skill':
        opts.installSkill = false;
        break;
      case '--no-grant-viewer':
        opts.grantViewer = false;
        break;
      default:
        break;
    }
  }

  return opts;
}

function runAzJson<T>(args: string[]): T {
  const output = execFileSync('az', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output) as T;
}

function runAzTsv(args: string[]): string {
  return execFileSync('az', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getAzureAccount(): AzureAccount {
  return runAzJson<AzureAccount>(['account', 'show', '-o', 'json']);
}

function getWorkspaceFromArgs(opts: FabricSetupOptions): FabricWorkspace {
  const token = runAzTsv([
    'account',
    'get-access-token',
    '--resource',
    'https://analysis.windows.net/powerbi/api',
    '--query',
    'accessToken',
    '-o',
    'tsv',
  ]);

  const response = execFileSync(
    'curl',
    [
      '-s',
      '-H',
      `Authorization: Bearer ${token}`,
      'https://api.powerbi.com/v1.0/myorg/groups',
    ],
    {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const parsed = JSON.parse(response) as { value?: FabricWorkspace[] };
  const workspaces = parsed.value || [];

  if (opts.workspaceId) {
    const match = workspaces.find((workspace) => workspace.id === opts.workspaceId);
    if (!match) {
      throw new Error(`Fabric workspace not found: ${opts.workspaceId}`);
    }
    return match;
  }

  if (opts.workspaceName) {
    const match = workspaces.find(
      (workspace) => workspace.name === opts.workspaceName,
    );
    if (!match) {
      throw new Error(`Fabric workspace not found: ${opts.workspaceName}`);
    }
    return match;
  }

  throw new Error('Fabric setup requires --workspace-id or --workspace-name');
}

function ensureAppRegistration(opts: FabricSetupOptions): {
  clientId: string;
  created: boolean;
} {
  if (opts.clientId) {
    return { clientId: opts.clientId, created: false };
  }

  const existing = runAzJson<Array<{ appId: string }>>([
    'ad',
    'app',
    'list',
    '--display-name',
    opts.appName,
    '--query',
    '[].{appId:appId}',
    '-o',
    'json',
  ]);

  if (existing.length > 0) {
    return { clientId: existing[0].appId, created: false };
  }

  const created = runAzJson<{ appId: string }>([
    'ad',
    'app',
    'create',
    '--display-name',
    opts.appName,
    '--query',
    '{appId:appId}',
    '-o',
    'json',
  ]);

  return { clientId: created.appId, created: true };
}

function ensureServicePrincipal(clientId: string): void {
  try {
    execFileSync(
      'az',
      ['ad', 'sp', 'show', '--id', clientId, '--query', 'appId', '-o', 'tsv'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    runAzTsv(['ad', 'sp', 'create', '--id', clientId, '--query', 'appId', '-o', 'tsv']);
  }
}

function createClientSecret(clientId: string): string {
  return runAzTsv([
    'ad',
    'app',
    'credential',
    'reset',
    '--id',
    clientId,
    '--append',
    '--display-name',
    'agentos-fabric',
    '--query',
    'password',
    '-o',
    'tsv',
  ]);
}

function grantWorkspaceViewer(workspaceId: string, clientId: string): void {
  const token = runAzTsv([
    'account',
    'get-access-token',
    '--resource',
    'https://analysis.windows.net/powerbi/api',
    '--query',
    'accessToken',
    '-o',
    'tsv',
  ]);

  const payload = JSON.stringify({
    identifier: clientId,
    groupUserAccessRight: 'Viewer',
    principalType: 'App',
  });

  execFileSync(
    'curl',
    [
      '-s',
      '-X',
      'POST',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      payload,
      `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/users`,
    ],
    {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function isFabricSkillApplied(projectRoot: string): boolean {
  const statePath = path.join(projectRoot, '.nanoclaw', 'state.yaml');
  if (!fs.existsSync(statePath)) return false;

  const parsed = YAML.parse(fs.readFileSync(statePath, 'utf-8')) as
    | { applied_skills?: Array<{ skill: string }> }
    | undefined;

  return (
    parsed?.applied_skills?.some((skill) => skill.skill === 'fabric-readonly') ??
    false
  );
}

async function ensureFabricSkill(projectRoot: string): Promise<boolean> {
  if (isFabricSkillApplied(projectRoot)) {
    return false;
  }

  if (!fs.existsSync(path.join(projectRoot, '.nanoclaw'))) {
    initNanoclawDir();
  }

  const result = await applySkill(
    path.join(projectRoot, '.claude', 'skills', 'add-fabric-readonly'),
  );
  if (!result.success) {
    throw new Error(result.error || 'Failed to apply fabric-readonly skill');
  }

  return true;
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const opts = parseArgs(args);

  if (!fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'setup', 'SKILL.md'))) {
    throw new Error('Run this step from the AgentOS project root');
  }

  logger.info({ opts }, 'Starting Fabric setup');

  const account = getAzureAccount();
  const workspace = getWorkspaceFromArgs(opts);
  const app = ensureAppRegistration(opts);
  ensureServicePrincipal(app.clientId);

  let secretCreated = false;
  let clientSecret = '';
  if (opts.createSecret) {
    clientSecret = createClientSecret(app.clientId);
    secretCreated = clientSecret.length > 0;
  }

  let skillApplied = false;
  if (opts.installSkill) {
    skillApplied = await ensureFabricSkill(projectRoot);
  }

  if (opts.grantViewer) {
    grantWorkspaceViewer(workspace.id, app.clientId);
  }

  const envVars: Record<string, string> = {
    AZURE_TENANT_ID: account.tenantId,
    AZURE_CLIENT_ID: app.clientId,
    FABRIC_WORKSPACE_ID: workspace.id,
  };
  if (clientSecret) {
    envVars.AZURE_CLIENT_SECRET = clientSecret;
  }
  upsertEnvVars(path.join(projectRoot, '.env'), envVars);

  emitStatus('FABRIC_SETUP', {
    TENANT_ID: account.tenantId,
    CLIENT_ID: app.clientId,
    WORKSPACE_ID: workspace.id,
    WORKSPACE_NAME: workspace.name,
    APP_CREATED: app.created,
    SECRET_CREATED: secretCreated,
    SKILL_APPLIED: skillApplied,
    VIEWER_GRANTED: opts.grantViewer,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}

export const _internals = {
  parseArgs,
  isFabricSkillApplied,
};
