---
name: add-fabric-readonly
description: Add read-only Azure Fabric integration via custom MCP server. Browse workspaces, query data, check pipelines, trace lineage — all read-only, no write operations.
---

# Add Azure Fabric (Read-Only)

This skill adds a stdio-based MCP server that exposes read-only Azure Fabric operations as tools for the container agent. The agent can browse workspaces, query data, check job status, and trace lineage — but cannot create, modify, or delete anything.

Tools added:
- `fabric_list_workspaces` — list accessible workspaces
- `fabric_list_items` — list items in a workspace (filter by type)
- `fabric_get_item` — get item details and connection info
- `fabric_list_tables` — list tables in a lakehouse
- `fabric_get_table_schema` — get column names, types, nullability
- `fabric_query_sql` — execute read-only SELECT queries (writes rejected)
- `fabric_query_kql` — execute KQL queries against Eventhouses
- `fabric_list_job_instances` — list pipeline/notebook run history
- `fabric_get_job_instance` — get details of a specific run
- `fabric_list_onelake_files` — browse OneLake files and directories
- `fabric_list_reports` — list Power BI reports
- `fabric_get_dataset_refresh_history` — check semantic model refresh history
- `fabric_get_item_lineage` — trace upstream/downstream dependencies

## Read-Only Enforcement

Safety is enforced at multiple layers:
1. **Azure RBAC** — Service Principal must have **Reader role only** (hard boundary)
2. **Custom MCP server** — only read operations exist in code (no write endpoints)
3. **SQL sanitization** — only SELECT/WITH queries allowed; INSERT/UPDATE/DELETE/etc. rejected
4. **Credential isolation** — AZURE_CLIENT_SECRET stripped from Bash subprocesses

## Phase 1: Pre-flight

### Check if already applied

Read `.agentos/state.yaml`. If `fabric-readonly` is in `applied_skills`, skip to Phase 3 (Configure). The code changes are already in place.

### Check prerequisites

1. Verify Azure CLI is available (optional, for credential setup):

```bash
az --version
```

2. User needs:
   - An Azure AD tenant
   - A Fabric workspace
   - An App Registration (Service Principal) with **Reader role only** on the workspace

## Phase 2: Apply Code Changes

Run the skills engine to apply this skill's code package.

### Initialize skills system (if needed)

If `.agentos/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-fabric-readonly
```

This deterministically:
- Adds `container/agent-runner/src/fabric-readonly-mcp-stdio.ts` (Fabric read-only MCP server)
- Adds `container/skills/fabric-readonly/SKILL.md` (in-container agent guidance)
- Three-way merges Fabric MCP config into `container/agent-runner/src/index.ts` (allowedTools + mcpServers + SECRET_ENV_VARS)
- Three-way merges `[FABRIC]` log surfacing + Azure secrets into `src/container-runner.ts`
- Records the application in `.agentos/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/container/agent-runner/src/index.ts.intent.md` — what changed and invariants
- `modify/src/container-runner.ts.intent.md` — what changed and invariants

### Copy to per-group agent-runner

Existing groups have a cached copy of the agent-runner source. Copy the new files:

```bash
for dir in data/sessions/*/agent-runner-src; do
  cp container/agent-runner/src/fabric-readonly-mcp-stdio.ts "$dir/"
  cp container/agent-runner/src/index.ts "$dir/"
done
```

### Validate code changes

```bash
npm run build
./container/build.sh
```

Build must be clean before proceeding.

## Phase 3: Configure

### Create Azure Service Principal

If the user doesn't already have one:

1. Go to Azure Portal > Azure Active Directory > App registrations > New registration
2. Name: `agentos-fabric-reader` (or similar)
3. Create a client secret and note:
   - **Tenant ID** (from Overview)
   - **Client ID** (Application ID from Overview)
   - **Client Secret** (from Certificates & secrets)
4. **CRITICAL**: Assign **Reader** role only:
   - Go to the Fabric workspace > Settings > Manage access
   - Add the Service Principal with **Viewer** role
   - Do NOT grant Contributor, Member, or Admin

### Set credentials in .env

```bash
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
FABRIC_WORKSPACE_ID=your-default-workspace-id
```

The `FABRIC_WORKSPACE_ID` is optional but convenient — tools will use it as default when no workspace ID is specified.

### Restart the service

```bash
launchctl kickstart -k gui/$(id -u)/com.agentos  # macOS
# Linux: systemctl --user restart agentos
```

## Phase 4: Verify

### Test via messaging

Tell the user:

> Send a message like: "list my Fabric workspaces"
>
> The agent should use `fabric_list_workspaces` to return accessible workspaces.
>
> Then try: "show me the tables in lakehouse X"

### Check logs if needed

```bash
tail -f logs/agentos.log | grep -i fabric
```

Look for:
- `[FABRIC] Listing workspaces...` — MCP server called
- `[FABRIC] Found X workspaces` — successful response
- `[FABRIC] GET https://api.fabric.microsoft.com/...` — API calls

## Troubleshooting

### "Azure credentials not configured"

The MCP server can't find credentials. Check:
1. `.env` has `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
2. Service was restarted after adding credentials
3. Credentials flow through: `.env` → `readSecrets()` → container stdin → MCP server env

### Agent says "permission denied" or 403 errors

The Service Principal doesn't have access to the workspace:
1. Verify the SP is added to the Fabric workspace with at least Viewer role
2. Check that `FABRIC_WORKSPACE_ID` matches the workspace you granted access to

### "Only SELECT queries are allowed"

The SQL sanitizer rejected a write operation. This is by design — only SELECT queries are permitted. The agent should explain this to the user.

### Agent doesn't use Fabric tools

The agent may not know about the tools. Try being explicit: "use the fabric_list_workspaces tool to show my workspaces"

### MCP server not starting

1. Check the container was rebuilt: `./container/build.sh`
2. Check per-group source was updated (see Phase 2)
3. Check `container/agent-runner/src/index.ts` has the `fabric` entry in `mcpServers`
