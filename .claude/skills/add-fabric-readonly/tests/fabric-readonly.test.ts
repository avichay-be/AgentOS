import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Tests for the fabric-readonly skill.
 * Validates SQL sanitization logic, tool inventory, and skill structure.
 */

// --- SQL Sanitization Tests ---
// These test the sanitizeSql logic from fabric-readonly-mcp-stdio.ts
// Reimplemented here to validate the rules without importing the MCP server.

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|EXEC|EXECUTE|TRUNCATE|MERGE|GRANT|REVOKE|CALL|SET|BACKUP|RESTORE|DENY)\b/i;

function sanitizeSql(sql: string): string {
  let cleaned = sql.replace(/--[^\n]*/g, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const firstWord = cleaned.split(/\s/)[0]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    throw new Error(`Only SELECT queries are allowed. Got: ${firstWord}`);
  }

  if (WRITE_KEYWORDS.test(cleaned)) {
    const match = cleaned.match(WRITE_KEYWORDS);
    throw new Error(`Write operation "${match?.[0]}" is not allowed. Only SELECT queries are permitted.`);
  }

  const hasLimit = /\bTOP\s+\d/i.test(cleaned) || /\bLIMIT\s+\d/i.test(cleaned);
  if (!hasLimit) {
    if (firstWord === 'SELECT') {
      cleaned = cleaned.replace(/^SELECT\b/i, 'SELECT TOP 1000');
    }
  }

  return cleaned;
}

describe('SQL Sanitization', () => {
  it('allows simple SELECT', () => {
    const result = sanitizeSql('SELECT * FROM users');
    expect(result).toContain('SELECT');
    expect(result).toContain('TOP 1000');
  });

  it('allows SELECT with existing TOP', () => {
    const result = sanitizeSql('SELECT TOP 10 * FROM users');
    expect(result).toBe('SELECT TOP 10 * FROM users');
  });

  it('allows SELECT with LIMIT', () => {
    const result = sanitizeSql('SELECT * FROM users LIMIT 50');
    expect(result).toBe('SELECT * FROM users LIMIT 50');
  });

  it('allows WITH (CTE) queries', () => {
    const result = sanitizeSql('WITH cte AS (SELECT id FROM users) SELECT * FROM cte');
    expect(result).toContain('WITH cte');
  });

  it('strips line comments', () => {
    const result = sanitizeSql('SELECT * FROM users -- this is a comment');
    expect(result).not.toContain('comment');
  });

  it('strips block comments', () => {
    const result = sanitizeSql('SELECT * /* dangerous */ FROM users');
    expect(result).not.toContain('dangerous');
  });

  it('rejects INSERT', () => {
    expect(() => sanitizeSql('INSERT INTO users VALUES (1)')).toThrow('Only SELECT');
  });

  it('rejects UPDATE', () => {
    expect(() => sanitizeSql('UPDATE users SET name = "x"')).toThrow('Only SELECT');
  });

  it('rejects DELETE', () => {
    expect(() => sanitizeSql('DELETE FROM users')).toThrow('Only SELECT');
  });

  it('rejects CREATE', () => {
    expect(() => sanitizeSql('CREATE TABLE test (id INT)')).toThrow('Only SELECT');
  });

  it('rejects DROP', () => {
    expect(() => sanitizeSql('DROP TABLE users')).toThrow('Only SELECT');
  });

  it('rejects ALTER', () => {
    expect(() => sanitizeSql('ALTER TABLE users ADD col INT')).toThrow('Only SELECT');
  });

  it('rejects EXEC', () => {
    expect(() => sanitizeSql('EXEC sp_help')).toThrow('Only SELECT');
  });

  it('rejects TRUNCATE', () => {
    expect(() => sanitizeSql('TRUNCATE TABLE users')).toThrow('Only SELECT');
  });

  it('rejects MERGE', () => {
    expect(() => sanitizeSql('MERGE INTO target USING source ON ...')).toThrow('Only SELECT');
  });

  it('rejects GRANT', () => {
    expect(() => sanitizeSql('GRANT SELECT ON users TO public')).toThrow('Only SELECT');
  });

  it('rejects write keywords hidden in comments', () => {
    // The comment is stripped first, leaving just the SELECT
    const result = sanitizeSql('SELECT * FROM users /* DROP TABLE users */');
    expect(result).toContain('SELECT');
    expect(result).not.toContain('DROP');
  });

  it('rejects write keywords after valid SELECT', () => {
    expect(() => sanitizeSql('SELECT 1; DELETE FROM users')).toThrow('Write operation "DELETE"');
  });

  it('rejects case-insensitive write keywords', () => {
    expect(() => sanitizeSql('insert into users values (1)')).toThrow('Only SELECT');
  });
});

// --- Skill Structure Tests ---

describe('Skill Structure', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has manifest.yaml', () => {
    expect(fs.existsSync(path.join(skillDir, 'manifest.yaml'))).toBe(true);
  });

  it('has SKILL.md', () => {
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
  });

  it('has MCP server source', () => {
    expect(fs.existsSync(path.join(skillDir, 'add/container/agent-runner/src/fabric-readonly-mcp-stdio.ts'))).toBe(true);
  });

  it('has container skill', () => {
    expect(fs.existsSync(path.join(skillDir, 'add/container/skills/fabric-readonly/SKILL.md'))).toBe(true);
  });

  it('has index.ts modify target', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify/container/agent-runner/src/index.ts'))).toBe(true);
  });

  it('has index.ts intent', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify/container/agent-runner/src/index.ts.intent.md'))).toBe(true);
  });

  it('has container-runner.ts modify target', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify/src/container-runner.ts'))).toBe(true);
  });

  it('has container-runner.ts intent', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify/src/container-runner.ts.intent.md'))).toBe(true);
  });
});

// --- MCP Server Source Validation ---

describe('MCP Server Read-Only Enforcement', () => {
  const mcpServerPath = path.resolve(__dirname, '../add/container/agent-runner/src/fabric-readonly-mcp-stdio.ts');
  const source = fs.readFileSync(mcpServerPath, 'utf-8');

  it('does not contain PUT method calls', () => {
    // Check for fetch with PUT method
    expect(source).not.toMatch(/method:\s*['"]PUT['"]/i);
  });

  it('does not contain DELETE method calls', () => {
    expect(source).not.toMatch(/method:\s*['"]DELETE['"]/i);
  });

  it('does not contain PATCH method calls', () => {
    expect(source).not.toMatch(/method:\s*['"]PATCH['"]/i);
  });

  it('contains SQL sanitization', () => {
    expect(source).toContain('sanitizeSql');
    expect(source).toContain('WRITE_KEYWORDS');
  });

  it('has all 13 expected tools', () => {
    const tools = [
      'fabric_list_workspaces',
      'fabric_list_items',
      'fabric_get_item',
      'fabric_list_tables',
      'fabric_get_table_schema',
      'fabric_query_sql',
      'fabric_query_kql',
      'fabric_list_job_instances',
      'fabric_get_job_instance',
      'fabric_list_onelake_files',
      'fabric_list_reports',
      'fabric_get_dataset_refresh_history',
      'fabric_get_item_lineage',
    ];

    for (const tool of tools) {
      expect(source).toContain(`'${tool}'`);
    }
  });
});

// --- Modify Target Validation ---

describe('Modify Targets', () => {
  it('index.ts adds fabric to allowedTools', () => {
    const indexPath = path.resolve(__dirname, '../modify/container/agent-runner/src/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');
    expect(source).toContain("'mcp__fabric__*'");
  });

  it('index.ts adds AZURE_CLIENT_SECRET to SECRET_ENV_VARS', () => {
    const indexPath = path.resolve(__dirname, '../modify/container/agent-runner/src/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');
    expect(source).toContain("'AZURE_CLIENT_SECRET'");
  });

  it('index.ts adds fabric mcpServer config', () => {
    const indexPath = path.resolve(__dirname, '../modify/container/agent-runner/src/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');
    expect(source).toContain('fabric-readonly-mcp-stdio.js');
    expect(source).toContain('AZURE_TENANT_ID');
  });

  it('container-runner.ts adds Azure keys to readSecrets', () => {
    const crPath = path.resolve(__dirname, '../modify/src/container-runner.ts');
    const source = fs.readFileSync(crPath, 'utf-8');
    expect(source).toContain("'AZURE_TENANT_ID'");
    expect(source).toContain("'AZURE_CLIENT_ID'");
    expect(source).toContain("'AZURE_CLIENT_SECRET'");
    expect(source).toContain("'FABRIC_WORKSPACE_ID'");
  });

  it('container-runner.ts surfaces [FABRIC] logs', () => {
    const crPath = path.resolve(__dirname, '../modify/src/container-runner.ts');
    const source = fs.readFileSync(crPath, 'utf-8');
    expect(source).toContain("[FABRIC]");
    expect(source).toContain('logger.info');
  });
});
