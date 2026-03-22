# Intent: src/container-runner.ts modifications

## What changed
1. Added Azure Fabric credential keys to readSecrets() so they flow into containers via stdin
2. Surface [FABRIC] MCP log lines at info level alongside [OLLAMA]

## Key sections

### readSecrets() function
- Added: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `FABRIC_WORKSPACE_ID` to the readEnvFile allowlist

### container.stderr handler (inside runContainerAgent)
- Changed: empty line check from `if (line)` to `if (!line) continue;`
- Added: `[FABRIC]` tag detection — lines containing `[FABRIC]` or `[OLLAMA]` are logged at `logger.info` instead of `logger.debug`
- All other stderr lines remain at `logger.debug` level

## Invariants (must-keep)
- All existing volume mount logic unchanged
- Container lifecycle unchanged
- Stderr truncation logic unchanged
- Stdout parsing logic unchanged
- Timeout reset logic unchanged (stderr doesn't reset timeout)
