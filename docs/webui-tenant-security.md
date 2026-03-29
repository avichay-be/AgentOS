# AgentOS Web UI Tenant Security

## Objective

Expose the AgentOS Web UI to users in a single Microsoft tenant without exposing the raw AgentOS HTTP server directly to the internet.

## Security Baseline

AgentOS itself should remain a private control-plane service.

Current local defaults:

- `WEB_HOST=127.0.0.1`
- `WEB_PORT=5000`
- `WEB_ALLOWED_ORIGINS=` empty by default

This means the built-in UI and API are local-only unless you deliberately put something in front of them.

## Recommended Architecture

Use this pattern:

```text
Browser
  -> Tenant-authenticated frontend / reverse proxy
  -> Tenant-authenticated backend or BFF
  -> private AgentOS HTTP server on localhost/private network
```

Do not expose the AgentOS process directly as the tenant-facing app.

## Preferred Azure Topology

### Option A: BFF in front of AgentOS

Best fit when the UI needs sensitive operator actions.

Components:

- Entra ID single-tenant app registration
- frontend or reverse proxy that requires Entra sign-in
- backend-for-frontend that validates tenant, user, and role
- AgentOS reachable only on private address or localhost

Flow:

1. User signs in with Entra ID
2. BFF receives identity token / session
3. BFF checks tenant, audience, and app role
4. BFF calls AgentOS over private network
5. AgentOS never trusts the public browser directly

### Option B: Reverse proxy with auth headers plus private AgentOS

Acceptable if the proxy is fully trusted and AgentOS is not reachable except through it.

Requirements:

- TLS termination at the proxy
- Entra auth at the proxy layer
- private network path from proxy to AgentOS
- header forwarding only from the trusted proxy

This is simpler operationally, but weaker than a true BFF if you later need granular policy enforcement.

## Identity Model

Use Microsoft Entra ID in **single-tenant** mode.

Validate:

- issuer
- tenant id
- audience / client id
- token expiry
- signature

Authorize with app roles or groups, not just “signed in”.

Suggested roles:

- `AgentOS.Admin`
  Full access, including task deletion and future config changes
- `AgentOS.Operator`
  Read access plus operational task controls
- `AgentOS.Viewer`
  Read-only access

## AgentOS Network Rules

For tenant deployment:

- keep AgentOS on `127.0.0.1` or private ingress
- do not publish port `5000` publicly
- only the trusted proxy/BFF should reach AgentOS
- if frontend is separate, set `WEB_ALLOWED_ORIGINS` to exact origins only

Example:

```bash
WEB_HOST=127.0.0.1
WEB_PORT=5000
WEB_ALLOWED_ORIGINS=https://agentos.yourtenant.example
```

## API Hardening Requirements

Before tenant rollout, add or enforce:

- authentication middleware in front of mutation endpoints
- role-based authorization
- audit logs for pause/resume/delete operations
- CSRF protection if browser sessions use cookies
- exact-origin CORS only
- rate limiting at the edge
- secret redaction in logs and API payloads

## Secret Management

Do not keep tenant deployment secrets in `.env`.

Use:

- Azure Key Vault for secrets
- managed identity for backend access to Key Vault
- Entra metadata and app config from deployment environment

## Deployment Guidance

### If hosting in Azure Container Apps

Recommended:

- run AgentOS in an internal-only container app or private environment
- expose the tenant-facing frontend/BFF separately
- put Entra auth at the edge or BFF
- route private traffic from BFF to AgentOS

### If hosting in App Service or VM

Recommended:

- keep AgentOS bound to loopback
- run Nginx/Caddy/BFF locally on the same host
- enforce Entra auth before proxying requests to `127.0.0.1:5000`

## What AgentOS Should Trust

AgentOS should trust:

- its own local process state
- private calls from a trusted backend or proxy

AgentOS should not trust:

- arbitrary public browser traffic
- wildcard origins
- network location alone
- bearer tokens without tenant/audience validation

## Phased Path

### Phase 1

Local-only operations:

- AgentOS on `127.0.0.1:5000`
- no public exposure

### Phase 2

Tenant front door:

- Entra ID single-tenant auth
- trusted proxy or BFF
- exact allowed origin configured

### Phase 3

Operational hardening:

- app roles
- audit trails
- rate limiting
- central secret management
- mutation authorization by role

## Immediate Recommendation

For the next implementation step, build a small authenticated BFF in front of AgentOS rather than teaching the AgentOS process to be internet-facing itself.

That keeps the control-plane boundary clear and matches the security model of the rest of AgentOS.
