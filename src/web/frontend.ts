export function getFrontendCss(): string {
  return `
    :root {
      --bg: #f3efe4;
      --bg-accent: #efe2c1;
      --surface: rgba(255, 251, 242, 0.9);
      --surface-strong: #fff9eb;
      --ink: #172121;
      --muted: #5a655f;
      --line: rgba(23, 33, 33, 0.12);
      --good: #1d6f42;
      --warn: #b86a00;
      --bad: #a12a2a;
      --shadow: 0 18px 40px rgba(55, 40, 10, 0.12);
      --radius: 22px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "Segoe UI Variable", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(233, 181, 67, 0.32), transparent 28%),
        radial-gradient(circle at top right, rgba(28, 95, 67, 0.18), transparent 25%),
        linear-gradient(180deg, var(--bg) 0%, #f9f5ec 100%);
    }

    .shell {
      width: min(1400px, calc(100vw - 32px));
      margin: 24px auto 40px;
    }

    .hero {
      display: grid;
      gap: 18px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 32px;
      background: linear-gradient(135deg, rgba(255, 249, 235, 0.94), rgba(242, 233, 210, 0.88));
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto -8% -28% auto;
      width: 300px;
      height: 300px;
      border-radius: 50%;
      background: rgba(24, 116, 84, 0.08);
      filter: blur(10px);
    }

    .hero-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      flex-wrap: wrap;
    }

    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 12px;
      color: var(--muted);
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 5vw, 56px);
      line-height: 0.95;
      max-width: 10ch;
    }

    .hero-copy {
      margin: 14px 0 0;
      max-width: 64ch;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.6;
    }

    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.75);
      border: 1px solid var(--line);
      font-size: 13px;
    }

    button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      background: #163f36;
      color: #f6f1e8;
      padding: 11px 16px;
      font: inherit;
      cursor: pointer;
      transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      background: #0f3029;
    }

    button.secondary {
      background: rgba(255, 255, 255, 0.78);
      color: var(--ink);
      border: 1px solid var(--line);
    }

    button.warn {
      background: #8a5314;
    }

    button.danger {
      background: #912f2f;
    }

    .grid {
      display: grid;
      gap: 16px;
      margin-top: 18px;
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }

    .panel {
      grid-column: span 12;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(10px);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 18px 22px 10px;
    }

    .panel h2,
    .panel h3 {
      margin: 0;
      font-size: 18px;
    }

    .panel-copy {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 13px;
    }

    .panel-body {
      padding: 0 22px 22px;
    }

    .stats {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .stat-card {
      padding: 18px;
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 248, 232, 0.96));
      border: 1px solid rgba(23, 33, 33, 0.08);
    }

    .stat-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
    }

    .stat-value {
      margin-top: 12px;
      font-size: 34px;
      line-height: 1;
    }

    .table-wrap {
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(23, 33, 33, 0.08);
      background: rgba(255, 255, 255, 0.5);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    th,
    td {
      padding: 13px 14px;
      text-align: left;
      border-bottom: 1px solid rgba(23, 33, 33, 0.08);
      vertical-align: top;
      font-size: 14px;
    }

    th {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      background: rgba(255, 250, 242, 0.96);
      position: sticky;
      top: 0;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid rgba(23, 33, 33, 0.08);
      background: rgba(255, 255, 255, 0.75);
      font-size: 12px;
      white-space: nowrap;
    }

    .good { color: var(--good); }
    .warn-text { color: var(--warn); }
    .bad { color: var(--bad); }
    .muted { color: var(--muted); }

    .stack {
      display: grid;
      gap: 12px;
    }

    .log-list {
      display: grid;
      gap: 10px;
    }

    .log-item {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid rgba(23, 33, 33, 0.08);
      background: rgba(255, 255, 255, 0.66);
    }

    .log-item header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--muted);
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .actions button {
      padding: 8px 12px;
      font-size: 13px;
    }

    .empty {
      padding: 18px;
      border-radius: 16px;
      color: var(--muted);
      border: 1px dashed rgba(23, 33, 33, 0.16);
      background: rgba(255, 255, 255, 0.46);
    }

    @media (min-width: 960px) {
      .overview-panel {
        grid-column: span 7;
      }

      .channels-panel {
        grid-column: span 5;
      }

      .groups-panel,
      .tasks-panel,
      .runtime-panel,
      .logs-panel {
        grid-column: span 12;
      }
    }

    @media (max-width: 720px) {
      .shell {
        width: min(100vw, calc(100vw - 18px));
        margin: 10px auto 30px;
      }

      .hero,
      .panel-body,
      .panel-header {
        padding-left: 16px;
        padding-right: 16px;
      }

      h1 {
        max-width: none;
      }
    }
  `;
}

export function getFrontendHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentOS Console</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow">AgentOS Operator Console</p>
            <h1>Port 5000 control surface.</h1>
            <p class="hero-copy">
              This view is served by the main AgentOS process. It reads live queue state,
              recent logs, tasks, groups, and messages directly from the host runtime.
            </p>
          </div>
          <div class="controls">
            <div class="status-pill">
              <span>Auto-refresh</span>
              <strong id="refreshState">every 5s</strong>
            </div>
            <button id="syncGroupsBtn" class="secondary">Sync Groups</button>
            <button id="refreshBtn">Refresh Now</button>
          </div>
        </div>
      </section>

      <section class="grid">
        <article class="panel overview-panel">
          <div class="panel-header">
            <div>
              <h2>Overview</h2>
              <p class="panel-copy">System counts and runtime pressure.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="overviewStats" class="stats"></div>
          </div>
        </article>

        <article class="panel channels-panel">
          <div class="panel-header">
            <div>
              <h2>Channels</h2>
              <p class="panel-copy">Installed and connected channel adapters.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="channelList" class="stack"></div>
          </div>
        </article>

        <article class="panel groups-panel">
          <div class="panel-header">
            <div>
              <h2>Groups</h2>
              <p class="panel-copy">Registered chats, runtime status, and recent activity.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Channel</th>
                    <th>Folder</th>
                    <th>Trigger</th>
                    <th>Session</th>
                    <th>Tasks</th>
                    <th>Last Activity</th>
                    <th>Runtime</th>
                  </tr>
                </thead>
                <tbody id="groupsTable"></tbody>
              </table>
            </div>
          </div>
        </article>

        <article class="panel tasks-panel">
          <div class="panel-header">
            <div>
              <h2>Tasks</h2>
              <p class="panel-copy">Scheduled jobs with pause, resume, and delete actions.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prompt</th>
                    <th>Group</th>
                    <th>Schedule</th>
                    <th>Next Run</th>
                    <th>Last Result</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="tasksTable"></tbody>
              </table>
            </div>
          </div>
        </article>

        <article class="panel runtime-panel">
          <div class="panel-header">
            <div>
              <h2>Runtime</h2>
              <p class="panel-copy">Queue occupancy, live containers, and waiting groups.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="runtimeStats" class="stats"></div>
            <div id="runtimeGroups" class="stack" style="margin-top: 16px;"></div>
          </div>
        </article>

        <article class="panel logs-panel">
          <div class="panel-header">
            <div>
              <h2>Recent Logs</h2>
              <p class="panel-copy">Latest host-process events captured in memory.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="logList" class="log-list"></div>
          </div>
        </article>
      </section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

export function getFrontendJs(): string {
  return `
    const state = {
      overview: null,
      channels: [],
      groups: [],
      tasks: [],
      runtime: null,
      logs: [],
    };

    const el = {
      overviewStats: document.getElementById('overviewStats'),
      channelList: document.getElementById('channelList'),
      groupsTable: document.getElementById('groupsTable'),
      tasksTable: document.getElementById('tasksTable'),
      runtimeStats: document.getElementById('runtimeStats'),
      runtimeGroups: document.getElementById('runtimeGroups'),
      logList: document.getElementById('logList'),
      refreshBtn: document.getElementById('refreshBtn'),
      syncGroupsBtn: document.getElementById('syncGroupsBtn'),
    };

    function fmtDate(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function shortText(value, limit = 90) {
      if (!value) return '—';
      const text = String(value).trim();
      return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
    }

    function statusClass(status) {
      if (status === 'active' || status === 'success' || status === 'connected') return 'good';
      if (status === 'paused' || status === 'waiting') return 'warn-text';
      if (status === 'error' || status === 'disconnected') return 'bad';
      return 'muted';
    }

    function tag(label, status) {
      return '<span class="tag ' + statusClass(status) + '">' + escapeHtml(label) + '</span>';
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Request failed');
      }
      const contentType = response.headers.get('content-type') || '';
      return contentType.includes('application/json') ? response.json() : null;
    }

    async function load() {
      const [overview, channels, groups, tasks, runtime, logs] = await Promise.all([
        api('/api/overview'),
        api('/api/channels'),
        api('/api/groups'),
        api('/api/tasks'),
        api('/api/runtime'),
        api('/api/logs?limit=20'),
      ]);

      state.overview = overview;
      state.channels = channels.channels || [];
      state.groups = groups.groups || [];
      state.tasks = tasks.tasks || [];
      state.runtime = runtime;
      state.logs = logs.logs || [];

      render();
    }

    function render() {
      renderOverview();
      renderChannels();
      renderGroups();
      renderTasks();
      renderRuntime();
      renderLogs();
    }

    function renderOverview() {
      const summary = state.overview;
      if (!summary) return;

      const stats = [
        ['Connected Channels', summary.channels.connected, summary.channels.connected + '/' + summary.channels.installed],
        ['Registered Groups', summary.groups.registered, summary.groups.registered + ' registered'],
        ['Known Chats', summary.groups.knownChats, summary.groups.groups + ' group chats'],
        ['Tasks', summary.tasks.total, summary.tasks.active + ' active'],
        ['Queue Load', summary.runtime.activeCount, summary.runtime.activeCount + '/' + summary.runtime.maxConcurrent + ' active'],
        ['Recent Errors', summary.logs.errorCount, summary.logs.total + ' recent logs'],
      ];

      el.overviewStats.innerHTML = stats.map(([label, value, extra]) => {
        return '<div class="stat-card"><div class="stat-label">' + escapeHtml(label) + '</div><div class="stat-value">' + escapeHtml(value) + '</div><div class="muted" style="margin-top:8px;">' + escapeHtml(extra) + '</div></div>';
      }).join('');
    }

    function renderChannels() {
      if (!state.channels.length) {
        el.channelList.innerHTML = '<div class="empty">No channels are installed.</div>';
        return;
      }

      el.channelList.innerHTML = state.channels.map((channel) => {
        const status = channel.connected && channel.healthy ? 'connected' : 'disconnected';
        return '<div class="log-item"><header><strong>' + escapeHtml(channel.name) + '</strong>' + tag(status, status) + '</header><div class="muted">Installed: ' + escapeHtml(channel.installed ? 'yes' : 'no') + ' • Live health: ' + escapeHtml(channel.healthy ? 'ok' : 'not ready') + '</div></div>';
      }).join('');
    }

    function renderGroups() {
      if (!state.groups.length) {
        el.groupsTable.innerHTML = '<tr><td colspan="8"><div class="empty">No known groups yet.</div></td></tr>';
        return;
      }

      el.groupsTable.innerHTML = state.groups.map((group) => {
        const runtimeLabel = group.runtime?.active
          ? (group.runtime.isTaskContainer ? 'task container' : 'agent active')
          : group.runtime?.waiting
            ? 'waiting'
            : 'idle';

        return '<tr>'
          + '<td><strong>' + escapeHtml(group.name) + '</strong><div class="muted">' + escapeHtml(group.jid) + '</div></td>'
          + '<td>' + escapeHtml(group.channel || 'unknown') + '</td>'
          + '<td>' + escapeHtml(group.folder || '—') + '</td>'
          + '<td>' + tag(group.requiresTrigger ? 'triggered' : 'free', group.requiresTrigger ? 'paused' : 'active') + '</td>'
          + '<td>' + tag(group.hasSession ? 'present' : 'none', group.hasSession ? 'connected' : 'disconnected') + '</td>'
          + '<td>' + escapeHtml(group.taskCount) + '</td>'
          + '<td>' + escapeHtml(fmtDate(group.lastActivity)) + '</td>'
          + '<td>' + tag(runtimeLabel, runtimeLabel === 'idle' ? 'disconnected' : runtimeLabel === 'waiting' ? 'waiting' : 'connected') + '</td>'
          + '</tr>';
      }).join('');
    }

    function renderTasks() {
      if (!state.tasks.length) {
        el.tasksTable.innerHTML = '<tr><td colspan="7"><div class="empty">No tasks scheduled.</div></td></tr>';
        return;
      }

      el.tasksTable.innerHTML = state.tasks.map((task) => {
        const actionButtons = [];
        if (task.status === 'active') {
          actionButtons.push('<button class="secondary" data-action="pause" data-task-id="' + escapeHtml(task.id) + '">Pause</button>');
        }
        if (task.status === 'paused') {
          actionButtons.push('<button class="warn" data-action="resume" data-task-id="' + escapeHtml(task.id) + '">Resume</button>');
        }
        actionButtons.push('<button class="danger" data-action="delete" data-task-id="' + escapeHtml(task.id) + '">Delete</button>');

        return '<tr>'
          + '<td><strong>' + escapeHtml(shortText(task.prompt, 100)) + '</strong><div class="muted">' + escapeHtml(task.id) + '</div></td>'
          + '<td>' + escapeHtml(task.groupName || task.group_folder) + '</td>'
          + '<td>' + tag(task.schedule_type, 'active') + '<div class="muted" style="margin-top:6px;">' + escapeHtml(task.schedule_value) + '</div></td>'
          + '<td>' + escapeHtml(fmtDate(task.next_run)) + '</td>'
          + '<td>' + escapeHtml(shortText(task.last_result, 90)) + '</td>'
          + '<td>' + tag(task.status, task.status) + '</td>'
          + '<td><div class="actions">' + actionButtons.join('') + '</div></td>'
          + '</tr>';
      }).join('');
    }

    function renderRuntime() {
      const runtime = state.runtime;
      if (!runtime) return;

      const groups = runtime.queue?.groups || [];
      const runtimeStats = [
        ['Active Containers', runtime.queue.activeCount, runtime.queue.activeCount + '/' + runtime.queue.maxConcurrent],
        ['Waiting Groups', runtime.queue.waitingGroups.length, runtime.queue.waitingGroups.join(', ') || 'none'],
        ['Tracked Groups', groups.length, 'queue snapshots'],
        ['Sessions', Object.keys(runtime.sessions || {}).length, 'group sessions'],
      ];

      el.runtimeStats.innerHTML = runtimeStats.map(([label, value, extra]) => {
        return '<div class="stat-card"><div class="stat-label">' + escapeHtml(label) + '</div><div class="stat-value">' + escapeHtml(value) + '</div><div class="muted" style="margin-top:8px;">' + escapeHtml(extra) + '</div></div>';
      }).join('');

      if (!groups.length) {
        el.runtimeGroups.innerHTML = '<div class="empty">No live queue state yet.</div>';
        return;
      }

      el.runtimeGroups.innerHTML = groups.map((group) => {
        const lines = [
          'Pending messages: ' + group.pendingMessages,
          'Pending tasks: ' + group.pendingTaskCount,
          'Container: ' + (group.containerName || '—'),
          'Folder: ' + (group.groupFolder || '—'),
          'Retry count: ' + group.retryCount,
          'Last agent cursor: ' + (runtime.lastAgentTimestamp?.[group.groupJid] || '—'),
        ];
        return '<div class="log-item"><header><strong>' + escapeHtml(group.groupJid) + '</strong>' + tag(group.active ? 'active' : group.waiting ? 'waiting' : 'idle', group.active ? 'connected' : group.waiting ? 'waiting' : 'disconnected') + '</header><div class="muted">' + lines.map(escapeHtml).join(' • ') + '</div></div>';
      }).join('');
    }

    function renderLogs() {
      if (!state.logs.length) {
        el.logList.innerHTML = '<div class="empty">No logs captured yet.</div>';
        return;
      }

      el.logList.innerHTML = state.logs.map((entry) => {
        const details = entry.data && Object.keys(entry.data).length
          ? '<pre class="muted" style="white-space: pre-wrap; margin: 8px 0 0; font-size: 12px;">' + escapeHtml(JSON.stringify(entry.data, null, 2)) + '</pre>'
          : '';

        return '<article class="log-item"><header><span class="' + statusClass(entry.level) + '">' + escapeHtml(entry.level.toUpperCase()) + '</span><span>' + escapeHtml(fmtDate(entry.time)) + '</span></header><div>' + escapeHtml(entry.msg || '(no message)') + '</div>' + details + '</article>';
      }).join('');
    }

    async function mutateTask(taskId, action) {
      const method = action === 'delete' ? 'DELETE' : 'POST';
      await api('/api/tasks/' + encodeURIComponent(taskId) + '/' + action, { method });
      await load();
    }

    el.tasksTable.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-task-id]');
      if (!button) return;
      const taskId = button.dataset.taskId;
      const action = button.dataset.action;
      if (!taskId || !action) return;
      button.disabled = true;
      try {
        await mutateTask(taskId, action);
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    });

    el.refreshBtn.addEventListener('click', () => {
      load().catch((error) => alert(error instanceof Error ? error.message : String(error)));
    });

    el.syncGroupsBtn.addEventListener('click', async () => {
      el.syncGroupsBtn.disabled = true;
      try {
        await api('/api/channels/sync-groups', { method: 'POST' });
        await load();
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        el.syncGroupsBtn.disabled = false;
      }
    });

    load().catch((error) => {
      alert(error instanceof Error ? error.message : String(error));
    });
    setInterval(() => {
      load().catch(() => {});
    }, 5000);
  `;
}
