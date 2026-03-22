# Intent: container/agent-runner/src/index.ts modifications

## What changed
Added Fabric read-only MCP server so the container agent can browse and query Azure Fabric data. All operations are read-only — no write tools exist.

## Key sections

### SECRET_ENV_VARS array (line ~191)
- Added: `'AZURE_CLIENT_SECRET'` to prevent leaking to Bash subprocesses

### allowedTools array (inside runQuery → options)
- Added: `'mcp__fabric__*'` after `'mcp__nanoclaw__*'`

### mcpServers object (inside runQuery → options)
- Added: `fabric` entry as a stdio MCP server
  - command: `'node'`
  - args: resolves to `fabric-readonly-mcp-stdio.js` in the same directory as `ipc-mcp-stdio.js`
  - env: passes `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `FABRIC_WORKSPACE_ID` from sdkEnv

## Invariants (must-keep)
- All existing allowedTools entries unchanged
- nanoclaw MCP server config unchanged
- All other query options (permissionMode, hooks, env, etc.) unchanged
- MessageStream class unchanged
- IPC polling logic unchanged
- Session management unchanged
