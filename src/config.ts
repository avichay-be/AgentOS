import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_POOL',
  'WEB_HOST',
  'WEB_PORT',
  'WEB_ALLOWED_ORIGINS',
  'WEB_INTERNAL_API_TOKEN',
  'WEBAPP_HOST',
  'WEBAPP_PORT',
  'WEBAPP_AUTH_MODE',
  'WEBAPP_SESSION_SECRET',
  'WEBAPP_INTERNAL_BASE_URL',
  'WEBAPP_PUBLIC_BASE_URL',
  'WEBAPP_ENTRA_TENANT_ID',
  'WEBAPP_ENTRA_CLIENT_ID',
  'WEBAPP_ENTRA_CLIENT_SECRET',
  'WEBAPP_DEV_USER_ID',
  'WEBAPP_DEV_USER_NAME',
  'WEBAPP_DEV_EMAIL',
  'WEBAPP_DEV_ROLE',
  'DISABLED_CHANNELS',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'agentos',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'agentos',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'agentos-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const TELEGRAM_BOT_POOL = (
  process.env.TELEGRAM_BOT_POOL ||
  envConfig.TELEGRAM_BOT_POOL ||
  ''
)
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

export const WEB_HOST =
  process.env.WEB_HOST || envConfig.WEB_HOST || '127.0.0.1';
export const WEB_PORT = Math.max(
  1,
  parseInt(process.env.WEB_PORT || envConfig.WEB_PORT || '5000', 10) || 5000,
);
export const WEB_ALLOWED_ORIGINS = (
  process.env.WEB_ALLOWED_ORIGINS ||
  envConfig.WEB_ALLOWED_ORIGINS ||
  ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const WEB_INTERNAL_API_TOKEN =
  process.env.WEB_INTERNAL_API_TOKEN || envConfig.WEB_INTERNAL_API_TOKEN || '';

export const WEBAPP_HOST =
  process.env.WEBAPP_HOST || envConfig.WEBAPP_HOST || '127.0.0.1';
export const WEBAPP_PORT = Math.max(
  1,
  parseInt(process.env.WEBAPP_PORT || envConfig.WEBAPP_PORT || '5100', 10) ||
    5100,
);
export const WEBAPP_AUTH_MODE =
  process.env.WEBAPP_AUTH_MODE || envConfig.WEBAPP_AUTH_MODE || 'dev';
export const WEBAPP_SESSION_SECRET =
  process.env.WEBAPP_SESSION_SECRET || envConfig.WEBAPP_SESSION_SECRET || '';
export const WEBAPP_INTERNAL_BASE_URL =
  process.env.WEBAPP_INTERNAL_BASE_URL ||
  envConfig.WEBAPP_INTERNAL_BASE_URL ||
  `http://${WEB_HOST}:${WEB_PORT}`;
export const WEBAPP_PUBLIC_BASE_URL =
  process.env.WEBAPP_PUBLIC_BASE_URL ||
  envConfig.WEBAPP_PUBLIC_BASE_URL ||
  `http://${WEBAPP_HOST}:${WEBAPP_PORT}`;
export const WEBAPP_ENTRA_TENANT_ID =
  process.env.WEBAPP_ENTRA_TENANT_ID || envConfig.WEBAPP_ENTRA_TENANT_ID || '';
export const WEBAPP_ENTRA_CLIENT_ID =
  process.env.WEBAPP_ENTRA_CLIENT_ID || envConfig.WEBAPP_ENTRA_CLIENT_ID || '';
export const WEBAPP_ENTRA_CLIENT_SECRET =
  process.env.WEBAPP_ENTRA_CLIENT_SECRET ||
  envConfig.WEBAPP_ENTRA_CLIENT_SECRET ||
  '';
export const WEBAPP_DEV_USER_ID =
  process.env.WEBAPP_DEV_USER_ID || envConfig.WEBAPP_DEV_USER_ID || 'dev-user';
export const WEBAPP_DEV_USER_NAME =
  process.env.WEBAPP_DEV_USER_NAME ||
  envConfig.WEBAPP_DEV_USER_NAME ||
  'AgentOS Developer';
export const WEBAPP_DEV_EMAIL =
  process.env.WEBAPP_DEV_EMAIL || envConfig.WEBAPP_DEV_EMAIL || '';
export const WEBAPP_DEV_ROLE =
  process.env.WEBAPP_DEV_ROLE || envConfig.WEBAPP_DEV_ROLE || 'Admin';

export const DISABLED_CHANNELS = (
  process.env.DISABLED_CHANNELS ||
  envConfig.DISABLED_CHANNELS ||
  ''
)
  .split(',')
  .map((channel) => channel.trim())
  .filter(Boolean);
