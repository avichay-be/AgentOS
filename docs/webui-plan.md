# AgentOS Web UI Plan

## Goal

Build a custom Web UI for AgentOS as an operator console, not as a generic chat product.

The UI should expose the system's real operating model:

- channels
- registered groups
- message history
- scheduled tasks
- runtime health
- logs and recent agent activity

## Why Custom UI

AgentOS is centered around a single-process orchestrator, SQLite state, scheduled tasks, per-group isolation, and container execution. That maps poorly to generic chat UIs.

A custom UI is a better fit because it can make first-class concepts out of:

- main group vs regular groups
- channel ownership of chats
- task lifecycle
- queue and runtime state
- container-backed agent execution

## Product Shape

The Web UI should be an admin and operations surface.

It should help answer:

- Is the system healthy?
- Which channels are connected?
- Which groups are active and registered?
- Why did a message not get a response?
- Which tasks are due, failing, or paused?
- What is the agent doing right now?

## Recommended Architecture

### Backend

Add a small in-process HTTP API inside AgentOS.

Suggested location:

- `src/web/server.ts`
- `src/web/routes/*`
- `src/web/services/*`

The API should wrap existing state and database functions rather than creating a parallel control plane.

Primary integration points:

- `src/index.ts`
- `src/db.ts`
- `src/task-scheduler.ts`
- `src/types.ts`

### Frontend

Add a separate frontend app:

- `webui/`

Suggested stack:

- React
- Vite
- TypeScript

For v1, use polling. Add SSE later if needed.

## V1 Scope

Start as read-heavy with a few safe write actions.

### Read Features

- system overview
- channel status
- registered groups
- recent messages per group
- scheduled tasks
- task run history
- recent logs
- current runtime state

### Write Features

- pause task
- resume task
- delete task

Defer these until later:

- sending manual chat messages
- editing mounts
- full group registration flows
- auth bootstrap flows
- advanced config editing

## Example Screens

### 1. Overview Dashboard

Purpose: fast health check for the whole system.

Panels:

- channels connected/disconnected
- known chats and registered groups
- active, paused, and failing tasks
- queue depth and current runtime activity

Additional sections:

- recent task failures
- latest agent runs
- recently active groups

### 2. Groups Page

Purpose: inspect group state and configuration.

Columns:

- group name
- channel
- JID
- registered status
- folder
- trigger required
- last activity

Group detail view:

- recent messages
- group settings
- container config summary
- current session id
- tasks for that group

### 3. Task Manager

Purpose: manage scheduled work.

Columns:

- prompt preview
- schedule type
- schedule value
- next run
- last run
- last result
- status
- linked group

Task detail view:

- run history
- duration
- recent errors
- pause/resume/delete actions

### 4. Conversation Inspector

Purpose: debug routing and response issues.

Show:

- inbound messages
- bot messages
- sender
- timestamps
- trigger presence
- whether agent processing started
- whether the run failed

### 5. Runtime and Logs

Purpose: inspect live system behavior.

Show:

- active queue entries
- currently running containers
- recent warnings/errors
- recent agent output snippets
- filters by group and channel

### 6. Main Group Control Center

Purpose: expose the special admin role of the main group.

Show:

- all groups across channels
- all scheduled tasks
- cross-group search
- global memory references
- system-level actions

## API Plan

### Read Endpoints

- `GET /api/health`
- `GET /api/overview`
- `GET /api/channels`
- `GET /api/groups`
- `GET /api/groups/:jid`
- `GET /api/groups/:jid/messages`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/runs`
- `GET /api/runtime`
- `GET /api/logs`

### Mutation Endpoints

- `POST /api/tasks/:id/pause`
- `POST /api/tasks/:id/resume`
- `DELETE /api/tasks/:id`

Later:

- `POST /api/groups/:jid/register`
- `PATCH /api/groups/:jid`
- `POST /api/groups/:jid/message`

## Data Mapping

Existing backend data already covers most of the UI:

- chats and messages from `src/db.ts`
- registered groups from `src/db.ts`
- tasks and run logs from `src/db.ts`
- runtime state from `src/index.ts`

What will likely need explicit API aggregation:

- channel connection status
- queue depth
- running containers
- last agent activity per group
- health summary for overview cards

## Milestones

### M1

Add HTTP server and read-only APIs for:

- overview
- groups
- tasks
- runtime

### M2

Build frontend pages:

- Overview
- Groups
- Tasks
- Runtime

### M3

Add safe task actions:

- pause
- resume
- delete

### M4

Add live updates:

- SSE for logs
- auto-refresh for runtime and task state

### M5

Add richer admin flows:

- group registration
- group config editing
- message send/debug actions

## Risks

### Architectural

- important runtime state is currently held in memory in `src/index.ts`
- some operator data is not yet exposed through reusable backend services

### Performance

- message history can grow large
- logs can grow large
- APIs need pagination and response size limits

### Security

- bind localhost by default
- require auth before any remote exposure
- redact secrets from logs and API payloads
- restrict mutation endpoints carefully

### Product

The UI should stay narrow. AgentOS currently leans toward an AI-native workflow instead of dashboards. The Web UI should support operations, not replace the core product model.

## Initial Navigation Proposal

For a pragmatic v1:

- Overview
- Groups
- Tasks
- Messages
- Runtime

This is enough to make the system understandable without turning AgentOS into a full chat SaaS UI.
