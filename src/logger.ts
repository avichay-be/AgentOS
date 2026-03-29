import pino from 'pino';

export interface RecentLogEntry {
  time: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  msg: string;
  data: Record<string, unknown>;
}

const MAX_RECENT_LOGS = 500;
const recentLogs: RecentLogEntry[] = [];

function mapLevel(level: number): RecentLogEntry['level'] {
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}

function rememberLog(args: unknown[], level: number): void {
  let msg = '';
  let data: Record<string, unknown> = {};

  const first = args[0];
  const second = args[1];

  if (typeof first === 'string') {
    msg = first;
  } else if (first instanceof Error) {
    msg = first.message;
    data = {
      err: {
        message: first.message,
        name: first.name,
      },
    };
  } else if (first && typeof first === 'object' && !Array.isArray(first)) {
    data = { ...(first as Record<string, unknown>) };
    if (typeof second === 'string') {
      msg = second;
    } else if (typeof data.msg === 'string') {
      msg = data.msg;
    }
  }

  if (!msg && typeof second === 'string') {
    msg = second;
  }

  recentLogs.push({
    time: new Date().toISOString(),
    level: mapLevel(level),
    msg,
    data,
  });

  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
  }
}

export function getRecentLogs(limit: number = 100): RecentLogEntry[] {
  const safeLimit = Math.max(1, Math.min(limit, MAX_RECENT_LOGS));
  return recentLogs.slice(-safeLimit).reverse();
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
  hooks: {
    logMethod(args, method, level) {
      rememberLog(args as unknown[], level);
      return (method as (...input: unknown[]) => void).apply(this, args);
    },
  },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
