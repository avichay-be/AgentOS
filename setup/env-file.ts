import fs from 'fs';
import path from 'path';

function escapeEnvValue(value: string): string {
  return JSON.stringify(value);
}

export function upsertEnvVars(
  envPath: string,
  vars: Record<string, string>,
): void {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const lines = content.length > 0 ? content.split('\n') : [];

  for (const [key, value] of Object.entries(vars)) {
    const rendered = `${key}=${escapeEnvValue(value)}`;
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = rendered;
    } else {
      lines.push(rendered);
    }
  }

  let next = lines.join('\n');
  if (!next.endsWith('\n')) {
    next += '\n';
  }

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, next);
}
