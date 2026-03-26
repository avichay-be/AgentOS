# AgentOS Web UI Plan

## Goal

Build a Web UI for AgentOS as an operator console for the existing orchestrator, not as a separate chat product.

The UI should expose the real system model already present in the codebase:

- channels
- registered groups
- recent messages
- scheduled tasks
- task run history
- queue and runtime state
- logs and recent agent activity

## Deployment Decision

### Short Answer

The Web UI should **not** run inside the per-group agent container.

It should sit on top of the **main host process** that already owns:

- SQLite state in `src/db.ts`
- in-memory runtime state in `src/index.ts`
- queue/process state in `src/group-queue.ts`
- scheduler state in `src/task-scheduler.ts`
- IPC control flow in `src/ipc.ts`

### Recommended Layout

Use a split design:

- backend API runs in the main AgentOS Node process
- frontend runs as a separate app during development
- frontend is built into static assets for production and served by the host API

Recommended folders:

- `src/web/server.ts`
- `src/web/routes/*`
- `src/web/services/*`
- `webui/`

### Why Not Inside the Agent Container

The container at `container/agent-runner/` is an ephemeral execution environment for Claude, not the control plane.

Running the UI there would be wrong because it does not own:

- channel connections
- the authoritative SQLite database lifecycle
- the live queue state
- the registered channel instances
- scheduler control

It would also weaken the isolation model by mixing operator control with agent execution.

### Docker Guidance

There are two different Docker questions here:

1. Should the UI run inside the **agent runner** container?

No.

2. Can the host app and Web UI be packaged together in a normal app container later?

Yes. If AgentOS itself is later deployed in Docker, the HTTP API and static Web UI can ship with the main app process container. They should still remain separate from the transient per-group agent containers.

## Product Shape

The Web UI is an operations surface for the owner of AgentOS.

It should answer:

- Is AgentOS healthy?
- Which channels are connected?
- Which groups are registered?
- What messages came in recently?
- Why did a group not get a response?
- Which tasks are active, paused, failing, or overdue?
- What is running right now?

It should not try to replace the AI-native workflow described in `README.md`.

## Existing Data Sources

The current codebase already contains most of the needed data.

### SQLite-backed data

From `src/db.ts`:

- chats
- registered groups
- messages
- scheduled tasks
- task run logs
- sessions
- router cursors

These map naturally to:

- groups list
- message history
- task manager
- task detail pages
- conversation inspector

### In-memory runtime data

From `src/index.ts` and `src/group-queue.ts`:

- connected channel instances
- `lastAgentTimestamp`
- active queue entries
- pending message state
- active container process references
- per-group runtime status

This data is not persisted today, so the API needs an explicit runtime snapshot layer.

### Process and log data

From `src/logger.ts` and process state:

- current log stream
- startup/shutdown errors
- warnings from channel/runtime/scheduler paths

For v1, logs can be exposed from an in-memory ring buffer attached to the logger transport rather than by scraping terminal output.

## Backend Design

### Principle

Do not create a parallel control plane.

The Web API should wrap the current orchestrator state and database access. It should not re-implement scheduling, routing, or queue logic in a separate service.

### Required Backend Additions

#### 1. Web server bootstrap

Add HTTP startup from `src/index.ts`.

Suggested files:

- `src/web/server.ts`
- `src/web/app.ts`

Responsibilities:

- bind to `127.0.0.1` by default
- serve `/api/*`
- optionally serve static frontend assets in production

#### 2. App context object

The web layer needs read access to live state without reaching into module globals in an ad hoc way.

Create a small context object passed from `src/index.ts` containing:

- `channels`
- `queue`
- `registeredGroups`
- `sessions`
- `getAvailableGroups`
- `syncGroups`

This avoids duplicating ownership.

#### 3. Queue/runtime snapshot methods

`src/group-queue.ts` needs read-only inspection helpers for the UI.

Add methods such as:

- `getSnapshot()`
- `getGroupSnapshot(groupJid)`

Expose:

- `activeCount`
- waiting groups
- pending tasks per group
- pending messages flag
- idle-waiting status
- active container name
- current group folder
- retry count

#### 4. Channel snapshot service

The UI needs to know:

- installed channel names
- whether each channel connected successfully
- whether each channel reports `isConnected()`

This should come from the actual instantiated channels in `src/index.ts`.

#### 5. Log buffering

Add a bounded in-memory log collector for recent UI inspection.

V1 target:

- keep the last 500 to 1000 structured log entries
- expose filtered retrieval by level, group, and channel where possible

#### 6. Safe mutation handlers

V1 write actions should be limited to scheduled tasks:

- pause task
- resume task
- delete task

These already map cleanly to `updateTask()` and `deleteTask()` in `src/db.ts`.

## Frontend Design

### Stack

Use:

- React
- Vite
- TypeScript

### Data transport

For v1:

- normal REST endpoints
- polling every 3 to 10 seconds for runtime-heavy views

Later:

- SSE for logs
- SSE for runtime updates if polling feels too stale

### Production serving

Use a pragmatic model:

- development: Vite dev server on its own port
- production: `webui/dist` served by the AgentOS HTTP server

That keeps local iteration simple and deployment simple.

## V1 Scope

Start read-heavy with a small number of safe controls.

### Read features

- overview dashboard
- channel status
- groups list
- group detail
- recent messages
- tasks list
- task detail with run history
- runtime view
- recent logs

### Write features

- pause task
- resume task
- delete task
- trigger group metadata sync manually

### Explicitly out of scope for v1

- live chat console
- arbitrary message send
- mount editing
- auth bootstrap
- container configuration editing
- direct filesystem browsing through the UI

## Screens

### 1. Overview

Purpose: quick system health.

Widgets:

- connected vs disconnected channels
- registered groups count
- active, paused, completed tasks
- groups waiting in queue
- currently running containers
- recent failures

### 2. Groups

Purpose: inspect registration and group state.

List columns:

- name
- channel
- jid
- folder
- registered status
- main-group flag
- requires trigger
- last activity

Detail view:

- recent messages
- session id presence
- container config summary
- task list for the group
- runtime state for the group

### 3. Tasks

Purpose: operate scheduled jobs safely.

List columns:

- prompt preview
- group
- schedule type
- schedule value
- next run
- last run
- last result
- status

Detail view:

- full prompt
- run history
- recent errors
- pause/resume/delete actions

### 4. Conversations

Purpose: debug routing and missed-response issues.

Show:

- inbound messages
- bot messages
- sender
- timestamps
- trigger presence
- whether the group is registered
- whether runtime processing was likely attempted

### 5. Runtime

Purpose: show live operating state that is not fully visible in SQLite.

Show:

- active queue count
- waiting groups
- group-level active/idle state
- current container names
- retry backoff indicators
- recent runtime logs

## API Plan

### Read endpoints

- `GET /api/health`
- `GET /api/overview`
- `GET /api/channels`
- `GET /api/groups`
- `GET /api/groups/:jid`
- `GET /api/groups/:jid/messages?limit=100&before=...`
- `GET /api/groups/:jid/runtime`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/runs`
- `GET /api/runtime`
- `GET /api/logs`

### Write endpoints

- `POST /api/channels/sync-groups`
- `POST /api/tasks/:id/pause`
- `POST /api/tasks/:id/resume`
- `DELETE /api/tasks/:id`

### Example response shapes

#### `GET /api/overview`

Should aggregate:

- channel summary
- queue summary
- group summary
- task summary
- recent errors

#### `GET /api/runtime`

Should return a normalized snapshot of:

- queue totals
- active groups
- waiting groups
- active containers
- last agent activity per group if available

## Data Mapping

### Straight from the database

- `getAllChats()`
- `getAllRegisteredGroups()`
- `getAllTasks()`
- `getTaskById()`
- `getTasksForGroup()`
- `getMessagesSince()` for relative views

V1 likely also needs dedicated paginated read helpers such as:

- `getMessagesForChat(chatJid, limit, before)`
- `getTaskRunLogs(taskId, limit)`

### Requires light new aggregation

- channel connection state
- queue depth
- running containers
- last runtime activity
- overview counters
- recent errors/log snippets

## Milestones

### M1. Runtime exposure

- add AppContext from `src/index.ts`
- add queue snapshot methods
- add in-memory recent-log buffer
- add read-only `/api/health` and `/api/runtime`

### M2. Read-only operator UI

- scaffold `webui/`
- build Overview, Groups, Tasks, Runtime pages
- add polling-based data layer

### M3. Task controls

- add pause/resume/delete endpoints
- wire task actions into the UI
- add optimistic refresh with server confirmation

### M4. Conversation and debugging views

- add paginated message endpoints
- add task run history endpoints
- add conversation inspector page

### M5. Live updates

- add SSE for logs
- optionally add SSE for runtime deltas

## Security

The Web UI changes the threat model slightly because it introduces an operator surface.

V1 rules:

- bind to localhost by default
- no public exposure by default
- require an auth layer before allowing non-localhost use
- redact secrets from API payloads and logs
- keep mutation endpoints narrow
- do not proxy raw shell execution through the UI

If remote access is needed later, put it behind real authentication rather than assuming a trusted network.

## Recommendation

Build the Web UI **outside the agent runner containers**, with:

- an in-process HTTP API inside the main AgentOS host process
- a separate React frontend in `webui/`
- production static serving from the host API

That gives the UI access to the real state and control surfaces without breaking the container isolation model that AgentOS is built around.
