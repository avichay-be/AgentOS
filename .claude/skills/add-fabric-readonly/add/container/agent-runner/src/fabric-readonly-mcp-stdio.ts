/**
 * Azure Fabric Read-Only MCP Server for AgentOS
 * Exposes read-only Fabric operations as tools for the container agent.
 * SECURITY: Only GET requests + read-only SQL SELECT/KQL queries.
 * Write operations do not exist in this server.
 * Azure RBAC (Reader role) is the hard security boundary.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const FABRIC_WORKSPACE_ID = process.env.FABRIC_WORKSPACE_ID || '';
const FABRIC_API_BASE = 'https://api.fabric.microsoft.com/v1';
const ONELAKE_DFS_BASE = 'https://onelake.dfs.fabric.microsoft.com';

function log(msg: string): void {
  console.error(`[FABRIC] ${msg}`);
}

// --- Azure AD Token Management ---

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCache: Record<string, TokenCache> = {};

async function getToken(scope: string): Promise<string> {
  const cached = tokenCache[scope];
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    throw new Error('Azure credentials not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in .env');
  }

  const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Azure token error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache[scope] = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function fabricToken(): Promise<string> {
  return getToken('https://api.fabric.microsoft.com/.default');
}

async function onelakeToken(): Promise<string> {
  return getToken('https://storage.azure.com/.default');
}

// --- Fabric REST helpers (GET only) ---

async function fabricGet(path: string): Promise<unknown> {
  const token = await fabricToken();
  const url = `${FABRIC_API_BASE}${path}`;
  log(`GET ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fabric API error (${res.status}): ${errorText}`);
  }

  return res.json();
}

async function fabricGetAllPages(path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let url: string | null = `${FABRIC_API_BASE}${path}`;
  const token = await fabricToken();

  while (url) {
    log(`GET ${url}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Fabric API error (${res.status}): ${errorText}`);
    }

    const data = await res.json() as { value?: unknown[]; continuationUri?: string };
    if (data.value) items.push(...data.value);
    url = data.continuationUri || null;
  }

  return items;
}

// --- SQL Safety ---

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|EXEC|EXECUTE|TRUNCATE|MERGE|GRANT|REVOKE|CALL|SET|BACKUP|RESTORE|DENY)\b/i;

function sanitizeSql(sql: string): string {
  // Strip line comments
  let cleaned = sql.replace(/--[^\n]*/g, '');
  // Strip block comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // First keyword must be SELECT or WITH
  const firstWord = cleaned.split(/\s/)[0]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    throw new Error(`Only SELECT queries are allowed. Got: ${firstWord}`);
  }

  // Reject any write keywords
  if (WRITE_KEYWORDS.test(cleaned)) {
    const match = cleaned.match(WRITE_KEYWORDS);
    throw new Error(`Write operation "${match?.[0]}" is not allowed. Only SELECT queries are permitted.`);
  }

  // Auto-add TOP 1000 if no LIMIT or TOP clause
  const hasLimit = /\bTOP\s+\d/i.test(cleaned) || /\bLIMIT\s+\d/i.test(cleaned);
  if (!hasLimit) {
    if (firstWord === 'SELECT') {
      cleaned = cleaned.replace(/^SELECT\b/i, 'SELECT TOP 1000');
    }
    log('Auto-added TOP 1000 (no LIMIT/TOP in query)');
  }

  return cleaned;
}

// --- MCP Server ---

const server = new McpServer({
  name: 'fabric',
  version: '1.0.0',
});

// --- Workspace browsing ---

server.tool(
  'fabric_list_workspaces',
  'List all Azure Fabric workspaces accessible to this service principal. Returns workspace IDs and names.',
  {},
  async () => {
    log('Listing workspaces...');
    try {
      const items = await fabricGetAllPages('/workspaces');
      const workspaces = items as Array<{ id: string; displayName: string; type: string; capacityId: string }>;

      if (workspaces.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No accessible workspaces found. Check Service Principal permissions.' }] };
      }

      const list = workspaces
        .map(w => `- **${w.displayName}** (id: ${w.id}, type: ${w.type || 'Workspace'})`)
        .join('\n');

      log(`Found ${workspaces.length} workspaces`);
      return { content: [{ type: 'text' as const, text: `Workspaces:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_list_items',
  'List items in a Fabric workspace. Optionally filter by type (Lakehouse, Warehouse, Notebook, Pipeline, Report, SemanticModel, SQLEndpoint, KQLDatabase, Eventhouse, etc).',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID from config.'),
    type: z.string().optional().describe('Item type filter (e.g., "Lakehouse", "Warehouse", "Pipeline", "Report")'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided and FABRIC_WORKSPACE_ID not set.' }], isError: true };
    }

    log(`Listing items in workspace ${wsId}${args.type ? ` (type: ${args.type})` : ''}...`);
    try {
      const queryParam = args.type ? `?type=${encodeURIComponent(args.type)}` : '';
      const items = await fabricGetAllPages(`/workspaces/${wsId}/items${queryParam}`);
      const typed = items as Array<{ id: string; displayName: string; type: string; description?: string }>;

      if (typed.length === 0) {
        return { content: [{ type: 'text' as const, text: `No items found${args.type ? ` of type ${args.type}` : ''}.` }] };
      }

      const list = typed
        .map(i => `- **${i.displayName}** (type: ${i.type}, id: ${i.id})${i.description ? ` — ${i.description}` : ''}`)
        .join('\n');

      log(`Found ${typed.length} items`);
      return { content: [{ type: 'text' as const, text: `Items in workspace:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_get_item',
  'Get details of a specific Fabric item including connection info and properties.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    itemId: z.string().describe('Item ID'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Getting item ${args.itemId}...`);
    try {
      const item = await fabricGet(`/workspaces/${wsId}/items/${args.itemId}`) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Schema discovery ---

server.tool(
  'fabric_list_tables',
  'List tables in a Fabric Lakehouse.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    lakehouseId: z.string().describe('Lakehouse item ID'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Listing tables in lakehouse ${args.lakehouseId}...`);
    try {
      const items = await fabricGetAllPages(`/workspaces/${wsId}/lakehouses/${args.lakehouseId}/tables`);
      const tables = items as Array<{ name: string; type: string; format: string; location: string }>;

      if (tables.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No tables found in this lakehouse.' }] };
      }

      const list = tables
        .map(t => `- **${t.name}** (type: ${t.type || 'managed'}, format: ${t.format || 'delta'})`)
        .join('\n');

      log(`Found ${tables.length} tables`);
      return { content: [{ type: 'text' as const, text: `Tables:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_get_table_schema',
  'Get column names, types, and nullability for a table via the SQL analytics endpoint. Uses INFORMATION_SCHEMA.COLUMNS.',
  {
    sqlEndpoint: z.string().describe('SQL analytics endpoint hostname (e.g., "xxxxxxxx.datawarehouse.fabric.microsoft.com")'),
    database: z.string().describe('Database name (usually the lakehouse/warehouse name)'),
    tableName: z.string().describe('Table name to get schema for'),
  },
  async (args) => {
    log(`Getting schema for ${args.tableName}...`);
    try {
      const token = await fabricToken();
      const query = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${args.tableName.replace(/'/g, "''")}' ORDER BY ORDINAL_POSITION`;

      const res = await fetch(`https://${args.sqlEndpoint}/databases/${encodeURIComponent(args.database)}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`SQL endpoint error (${res.status}): ${errorText}`);
      }

      const data = await res.json() as { results?: Array<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; CHARACTER_MAXIMUM_LENGTH: number | null; NUMERIC_PRECISION: number | null }> };
      const cols = data.results || [];

      if (cols.length === 0) {
        return { content: [{ type: 'text' as const, text: `No columns found for table "${args.tableName}". Check the table name.` }] };
      }

      const list = cols
        .map(c => {
          let type = c.DATA_TYPE;
          if (c.CHARACTER_MAXIMUM_LENGTH) type += `(${c.CHARACTER_MAXIMUM_LENGTH})`;
          if (c.NUMERIC_PRECISION) type += `(${c.NUMERIC_PRECISION})`;
          return `- **${c.COLUMN_NAME}**: ${type}${c.IS_NULLABLE === 'YES' ? ' (nullable)' : ''}`;
        })
        .join('\n');

      log(`Found ${cols.length} columns`);
      return { content: [{ type: 'text' as const, text: `Schema for ${args.tableName}:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Data querying ---

server.tool(
  'fabric_query_sql',
  'Execute a read-only SQL SELECT query against a Fabric SQL analytics endpoint. Only SELECT statements are allowed — INSERT, UPDATE, DELETE, CREATE, DROP, etc. are rejected. Auto-adds TOP 1000 if no limit specified.',
  {
    sqlEndpoint: z.string().describe('SQL analytics endpoint hostname'),
    database: z.string().describe('Database name'),
    query: z.string().describe('SQL SELECT query to execute'),
  },
  async (args) => {
    log(`SQL query on ${args.database}...`);
    try {
      const safeSql = sanitizeSql(args.query);
      log(`Sanitized SQL: ${safeSql.slice(0, 200)}`);

      const token = await fabricToken();
      const res = await fetch(`https://${args.sqlEndpoint}/databases/${encodeURIComponent(args.database)}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: safeSql }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`SQL error (${res.status}): ${errorText}`);
      }

      const data = await res.json() as { results?: unknown[] };
      const results = data.results || [];

      log(`Query returned ${results.length} rows`);

      // Truncate large results to prevent context overflow
      const text = JSON.stringify(results, null, 2);
      const truncated = text.length > 50_000
        ? text.slice(0, 50_000) + `\n... (truncated, ${results.length} total rows)`
        : text;

      return { content: [{ type: 'text' as const, text: `Results (${results.length} rows):\n${truncated}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_query_kql',
  'Execute a KQL (Kusto Query Language) query against a Fabric Eventhouse / KQL Database. KQL is intrinsically read-only.',
  {
    kustoEndpoint: z.string().describe('Kusto cluster URI (e.g., "https://your-cluster.kusto.data.microsoft.com")'),
    database: z.string().describe('KQL database name'),
    query: z.string().describe('KQL query to execute'),
  },
  async (args) => {
    log(`KQL query on ${args.database}...`);
    try {
      const token = await getToken('https://kusto.kusto.windows.net/.default');

      const res = await fetch(`${args.kustoEndpoint}/v1/rest/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          db: args.database,
          csl: args.query,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`KQL error (${res.status}): ${errorText}`);
      }

      const data = await res.json() as { Tables?: Array<{ Columns?: Array<{ ColumnName: string }>; Rows?: unknown[][] }> };
      const table = data.Tables?.[0];

      if (!table || !table.Rows?.length) {
        return { content: [{ type: 'text' as const, text: 'Query returned no results.' }] };
      }

      const columns = table.Columns?.map(c => c.ColumnName) || [];
      const rows = table.Rows.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]])),
      );

      log(`KQL returned ${rows.length} rows`);

      const text = JSON.stringify(rows, null, 2);
      const truncated = text.length > 50_000
        ? text.slice(0, 50_000) + `\n... (truncated, ${rows.length} total rows)`
        : text;

      return { content: [{ type: 'text' as const, text: `Results (${rows.length} rows):\n${truncated}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Job monitoring ---

server.tool(
  'fabric_list_job_instances',
  'List recent job runs (pipeline, notebook, spark) for a Fabric item. Shows status, start time, and duration.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    itemId: z.string().describe('Item ID (pipeline, notebook, etc.)'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Listing job instances for item ${args.itemId}...`);
    try {
      const items = await fabricGetAllPages(`/workspaces/${wsId}/items/${args.itemId}/jobs/instances`);
      const jobs = items as Array<{
        id: string;
        status: string;
        startTimeUtc: string;
        endTimeUtc?: string;
        failureReason?: { message: string };
      }>;

      if (jobs.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No job runs found for this item.' }] };
      }

      const list = jobs.slice(0, 50).map(j => {
        const duration = j.endTimeUtc
          ? `${Math.round((new Date(j.endTimeUtc).getTime() - new Date(j.startTimeUtc).getTime()) / 1000)}s`
          : 'running';
        const failure = j.failureReason ? ` — ${j.failureReason.message}` : '';
        return `- **${j.status}** (${j.startTimeUtc}, ${duration})${failure} [id: ${j.id}]`;
      }).join('\n');

      log(`Found ${jobs.length} job instances`);
      return { content: [{ type: 'text' as const, text: `Job runs (showing up to 50):\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_get_job_instance',
  'Get details of a specific job run including status, timing, and failure reason.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    itemId: z.string().describe('Item ID'),
    jobInstanceId: z.string().describe('Job instance ID'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Getting job instance ${args.jobInstanceId}...`);
    try {
      const job = await fabricGet(`/workspaces/${wsId}/items/${args.itemId}/jobs/instances/${args.jobInstanceId}`) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- OneLake browsing ---

server.tool(
  'fabric_list_onelake_files',
  'List files and directories in a OneLake lakehouse path. Uses the ADLS Gen2 compatible API.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    itemId: z.string().describe('Lakehouse item ID'),
    path: z.string().optional().describe('Path within the lakehouse (e.g., "Files/raw" or "Tables"). Defaults to root.'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    const lakePath = args.path || '';
    log(`Listing OneLake files at ${wsId}/${args.itemId}/${lakePath}...`);
    try {
      const token = await onelakeToken();
      const dirParam = lakePath ? `&directory=${encodeURIComponent(lakePath)}` : '';
      const url = `${ONELAKE_DFS_BASE}/${wsId}/${args.itemId}?resource=filesystem&recursive=false${dirParam}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OneLake error (${res.status}): ${errorText}`);
      }

      const data = await res.json() as { paths?: Array<{ name: string; isDirectory?: boolean; contentLength?: number; lastModified?: string }> };
      const paths = data.paths || [];

      if (paths.length === 0) {
        return { content: [{ type: 'text' as const, text: `No files found at path "${lakePath || '/'}".` }] };
      }

      const list = paths
        .map(p => {
          const icon = p.isDirectory ? '[dir]' : '[file]';
          const size = p.contentLength ? ` (${(p.contentLength / 1024).toFixed(1)} KB)` : '';
          return `- ${icon} **${p.name}**${size}`;
        })
        .join('\n');

      log(`Found ${paths.length} entries`);
      return { content: [{ type: 'text' as const, text: `OneLake ${lakePath || '/'}:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Power BI ---

server.tool(
  'fabric_list_reports',
  'List Power BI reports in a workspace.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Listing reports in workspace ${wsId}...`);
    try {
      const items = await fabricGetAllPages(`/workspaces/${wsId}/reports`);
      const reports = items as Array<{ id: string; displayName: string; description?: string }>;

      if (reports.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No reports found.' }] };
      }

      const list = reports
        .map(r => `- **${r.displayName}** (id: ${r.id})${r.description ? ` — ${r.description}` : ''}`)
        .join('\n');

      log(`Found ${reports.length} reports`);
      return { content: [{ type: 'text' as const, text: `Reports:\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'fabric_get_dataset_refresh_history',
  'Get refresh history for a Power BI semantic model (dataset). Shows recent refresh status and timing.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    datasetId: z.string().describe('Semantic model (dataset) ID'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Getting refresh history for dataset ${args.datasetId}...`);
    try {
      const data = await fabricGet(`/workspaces/${wsId}/semanticModels/${args.datasetId}/refreshes`) as { value?: Array<{ requestId: string; status: string; startTime: string; endTime?: string; serviceExceptionJson?: string }> };
      const refreshes = data.value || [];

      if (refreshes.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No refresh history found.' }] };
      }

      const list = refreshes.slice(0, 20).map(r => {
        const duration = r.endTime
          ? `${Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 1000)}s`
          : 'in progress';
        const error = r.serviceExceptionJson ? ' (has error)' : '';
        return `- **${r.status}** (${r.startTime}, ${duration})${error}`;
      }).join('\n');

      log(`Found ${refreshes.length} refreshes`);
      return { content: [{ type: 'text' as const, text: `Refresh history (up to 20):\n${list}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Lineage ---

server.tool(
  'fabric_get_item_lineage',
  'Get upstream and downstream lineage for a Fabric item, showing data flow dependencies.',
  {
    workspaceId: z.string().optional().describe('Workspace ID. Defaults to FABRIC_WORKSPACE_ID.'),
    itemId: z.string().describe('Item ID to get lineage for'),
  },
  async (args) => {
    const wsId = args.workspaceId || FABRIC_WORKSPACE_ID;
    if (!wsId) {
      return { content: [{ type: 'text' as const, text: 'No workspace ID provided.' }], isError: true };
    }

    log(`Getting lineage for item ${args.itemId}...`);
    try {
      const lineage = await fabricGet(`/workspaces/${wsId}/items/${args.itemId}/getLineage`) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify(lineage, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// --- Start server ---

const transport = new StdioServerTransport();
await server.connect(transport);
log('Fabric read-only MCP server started');
