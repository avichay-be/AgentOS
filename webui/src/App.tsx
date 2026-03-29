import { useEffect, useRef, useState } from 'react';

type AuthMode = 'dev' | 'entra';
type Page = 'chat' | 'dashboards' | 'admin';

interface SessionUser {
  tenantId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: 'Viewer' | 'Operator' | 'Admin';
}

interface SessionResponse {
  authenticated: boolean;
  authMode: AuthMode;
  user?: SessionUser;
}

interface MessageAttachment {
  id: string;
  message_id: string;
  chat_jid: string;
  original_name: string;
  stored_name: string;
  content_type: string;
  size_bytes: number;
  relative_path: string;
  created_at: string;
}

interface Message {
  id: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  attachments?: MessageAttachment[];
}

interface ChatRuntimeResponse {
  runtime: {
    active: boolean;
    waiting: boolean;
    pendingMessages: boolean;
    pendingTaskCount: number;
    containerName: string | null;
  } | null;
  lastAgentTimestamp: string | null;
}

interface ChatEvent {
  type: 'message' | 'typing';
  timestamp: string;
  direction?: 'inbound' | 'outbound';
  message?: Message;
  isTyping?: boolean;
}

interface DashboardSummary {
  slug: string;
  title: string;
  description?: string;
  updatedAt?: string;
  kind: 'manifest' | 'html';
  origin: 'published' | 'legacy';
}

interface DashboardManifest {
  version: 1;
  slug: string;
  title: string;
  description?: string;
  updatedAt?: string;
  components: DashboardComponent[];
}

type DashboardComponent =
  | {
      type: 'hero';
      eyebrow?: string;
      title: string;
      subtitle?: string;
    }
  | {
      type: 'markdown';
      title?: string;
      markdown: string;
    }
  | {
      type: 'stats';
      title?: string;
      items: Array<{
        label: string;
        value: string;
        trend?: 'up' | 'down' | 'flat';
        detail?: string;
      }>;
    }
  | {
      type: 'table';
      title?: string;
      columns: string[];
      rows: string[][];
    }
  | {
      type: 'list';
      title?: string;
      items: Array<{
        title: string;
        body?: string;
        meta?: string;
      }>;
    }
  | {
      type: 'timeline';
      title?: string;
      items: Array<{
        label: string;
        timestamp?: string;
        body?: string;
      }>;
    }
  | {
      type: 'chart';
      title?: string;
      chartType: 'line' | 'bar';
      series: Array<{
        name: string;
        points: Array<{
          label: string;
          value: number;
        }>;
      }>;
    };

interface HtmlDashboardDocument {
  kind: 'html';
  version: 1;
  slug: string;
  title: string;
  description?: string;
  updatedAt?: string;
}

interface ManifestDashboardDocument {
  kind: 'manifest';
  manifest: DashboardManifest;
}

type PublishedDashboardDocument =
  | ManifestDashboardDocument
  | HtmlDashboardDocument;

interface WorkspaceSummary {
  tenantId: string;
  userId: string;
  jid: string;
  chatId: string;
  title: string;
  folder: string;
  displayName: string;
  email?: string;
  role: 'Viewer' | 'Operator' | 'Admin';
  createdAt: string;
  lastLoginAt: string;
  lastOpenedAt: string;
  taskCount?: number;
  dashboardCount?: number;
  runtime?: { active: boolean; waiting: boolean } | null;
}

interface AdminOverview {
  channels: { installed: number; connected: number };
  groups: { knownChats: number; groups: number; registered: number };
  tasks: { total: number; active: number; paused: number; completed: number };
  runtime: { activeCount: number; maxConcurrent: number; waitingGroups: number };
  logs: { total: number; errorCount: number };
}

interface AdminTask {
  id: string;
  prompt: string;
  status: 'active' | 'paused' | 'completed';
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  last_result: string | null;
}

interface AdminWorkspaceDetail {
  workspace: WorkspaceSummary;
  runtime: ChatRuntimeResponse['runtime'];
  messages: Message[];
  tasks: AdminTask[];
  dashboards: DashboardSummary[];
}

interface MessageAction {
  kind: 'open_dashboard' | 'publish_dashboard';
  slug?: string;
  title?: string;
}

const FILE_ACCEPT =
  '.txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.gif';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!(init?.body instanceof FormData) && init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function pathToPage(pathname: string): Page {
  if (pathname.startsWith('/dashboards')) return 'dashboards';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'chat';
}

function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const existing = new Map(messages.map((message) => [message.id, message]));
  existing.set(incoming.id, incoming);
  return [...existing.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

function updatePathQuery(pathname: string, key: string, value?: string): string {
  const [base, currentQuery] = pathname.split('?');
  const params = new URLSearchParams(currentQuery || '');
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
  const nextQuery = params.toString();
  return nextQuery ? `${base}?${nextQuery}` : base;
}

function buildChatPath(pathname: string, chatJid?: string): string {
  return updatePathQuery(pathname, 'chat', chatJid);
}

function dashboardSummaryKey(entry: DashboardSummary): string {
  return [
    entry.slug,
    entry.updatedAt || '',
    entry.kind,
    entry.origin,
  ].join(':');
}

function deriveMessageActions(
  previous: DashboardSummary[],
  next: DashboardSummary[],
): MessageAction[] {
  const previousKeys = new Set(previous.map(dashboardSummaryKey));
  const publishedChanges = next.filter(
    (entry) =>
      entry.origin === 'published' && !previousKeys.has(dashboardSummaryKey(entry)),
  );

  if (publishedChanges.length > 0) {
    return publishedChanges.map((entry) => ({
      kind: 'open_dashboard',
      slug: entry.slug,
      title: entry.title,
    }));
  }

  const currentLegacy = next.find((entry) => entry.slug === 'dashboard');
  if (!currentLegacy || currentLegacy.origin !== 'legacy') {
    return [];
  }

  const previousLegacy = previous.find((entry) => entry.slug === 'dashboard');
  if (!previousLegacy || dashboardSummaryKey(previousLegacy) !== dashboardSummaryKey(currentLegacy)) {
    return [{ kind: 'publish_dashboard', title: currentLegacy.title }];
  }

  return [];
}

function describeDashboard(entry: DashboardSummary): string {
  if (entry.origin === 'legacy') return 'Draft HTML';
  return entry.kind === 'html' ? 'HTML artifact' : 'Structured manifest';
}

function mergeChatList(
  chats: WorkspaceSummary[],
  incoming: WorkspaceSummary,
): WorkspaceSummary[] {
  const existing = new Map(chats.map((chat) => [chat.jid, chat]));
  existing.set(incoming.jid, incoming);
  return [...existing.values()].sort((left, right) =>
    (right.lastOpenedAt || '').localeCompare(left.lastOpenedAt || ''),
  );
}

function useLocationState() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setPathname(window.location.pathname);
    setSearch(window.location.search);
  };

  const replace = (nextPath: string) => {
    window.history.replaceState({}, '', nextPath);
    setPathname(window.location.pathname);
    setSearch(window.location.search);
  };

  return { pathname, search, navigate, replace };
}

function LoginGate({ authMode }: { authMode: AuthMode }) {
  return (
    <div className="login-shell">
      <div className="login-card">
        <p className="eyebrow">AgentOS Web</p>
        <h1>Browser chat for your isolated workspace.</h1>
        <p className="lede">
          This frontend talks to the tenant-facing BFF. The BFF talks to the
          private AgentOS control plane. Your browser never connects to the
          agent containers directly.
        </p>
        <a className="primary-button" href="/auth/login">
          {authMode === 'entra' ? 'Sign in with Entra ID' : 'Open dev session'}
        </a>
      </div>
    </div>
  );
}

function Shell({
  page,
  session,
  chats,
  selectedChatJid,
  creatingChat,
  onNavigate,
  onSelectChat,
  onCreateChat,
  children,
}: {
  page: Page;
  session: SessionUser;
  chats: WorkspaceSummary[];
  selectedChatJid: string;
  creatingChat: boolean;
  onNavigate: (path: string) => void;
  onSelectChat: (jid: string) => void;
  onCreateChat: () => void;
  children: React.ReactNode;
}) {
  const navItems = [
    { id: 'chat', label: 'Chat', path: '/chat' },
    { id: 'dashboards', label: 'Dashboards', path: '/dashboards' },
    ...(session.role === 'Operator' || session.role === 'Admin'
      ? [{ id: 'admin', label: 'Admin', path: '/admin' }]
      : []),
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-stack">
          <div>
            <p className="eyebrow">AgentOS Web</p>
            <h1 className="sidebar-title">Tenant-ready browser control.</h1>
          </div>

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-button ${page === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="sidebar-section">
            <div className="section-header">
              <strong>Chats</strong>
              <button
                className="secondary-button compact-button"
                onClick={onCreateChat}
                disabled={creatingChat}
              >
                {creatingChat ? 'Creating…' : 'New chat'}
              </button>
            </div>
            <div className="stack-list">
              {chats.map((chat) => (
                <button
                  key={chat.jid}
                  className={`dashboard-link chat-link ${
                    chat.jid === selectedChatJid ? 'active' : ''
                  }`}
                  onClick={() => onSelectChat(chat.jid)}
                >
                  <strong>{chat.title}</strong>
                  <span>{chat.chatId === 'default' ? 'Default chat' : chat.chatId}</span>
                  <small>Opened {formatTime(chat.lastOpenedAt)}</small>
                </button>
              ))}
              {chats.length === 0 && (
                <div className="empty-state compact-empty">
                  Chats will appear here after sign-in.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="session-card">
          <strong>{session.displayName}</strong>
          <span>{session.role}</span>
          <span>{session.email || session.userId}</span>
          <a href="/auth/logout">Sign out</a>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

function AttachmentChips({
  chatJid,
  attachments,
}: {
  chatJid: string;
  attachments: MessageAttachment[];
}) {
  return (
    <div className="chip-row">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          className="attachment-chip"
          href={`/app-api/chats/${encodeURIComponent(chatJid)}/attachments/${encodeURIComponent(
            attachment.id,
          )}/content`}
        >
          <strong>{attachment.original_name}</strong>
          <span>{formatBytes(attachment.size_bytes)}</span>
        </a>
      ))}
    </div>
  );
}

function ComposerFileList({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="chip-row">
      {files.map((file, index) => (
        <button
          key={`${file.name}-${file.size}-${index}`}
          type="button"
          className="attachment-chip removable-chip"
          onClick={() => onRemove(index)}
        >
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)} • Remove</span>
        </button>
      ))}
    </div>
  );
}

function MessageActionsRow({
  actions,
  onOpenDashboard,
  onPublishDashboard,
  publishing,
}: {
  actions: MessageAction[];
  onOpenDashboard: (slug: string) => void;
  onPublishDashboard: () => void;
  publishing: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="chip-row">
      {actions.map((action, index) => {
        if (action.kind === 'open_dashboard' && action.slug) {
          return (
            <button
              key={`${action.slug}-${index}`}
              type="button"
              className="secondary-button action-chip"
              onClick={() => onOpenDashboard(action.slug!)}
            >
              Open dashboard
            </button>
          );
        }

        return (
          <button
            key={`publish-${index}`}
            type="button"
            className="secondary-button action-chip"
            onClick={onPublishDashboard}
            disabled={publishing}
          >
            {publishing ? 'Publishing…' : 'Publish dashboard'}
          </button>
        );
      })}
    </div>
  );
}

function ChatPage({
  workspace,
  onNavigate,
}: {
  workspace: WorkspaceSummary | null;
  onNavigate: (path: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [runtime, setRuntime] = useState<ChatRuntimeResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'down'>(
    'connecting',
  );
  const [messageActions, setMessageActions] = useState<Record<string, MessageAction[]>>(
    {},
  );
  const [publishingMessageId, setPublishingMessageId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const dashboardSnapshotRef = useRef<DashboardSummary[]>([]);

  useEffect(() => {
    if (!workspace) {
      setMessages([]);
      setRuntime(null);
      setMessageActions({});
      return;
    }

    let active = true;
    dashboardSnapshotRef.current = [];
    setMessages([]);
    setRuntime(null);
    setMessageActions({});
    setStreamStatus('connecting');

    const fetchDashboards = async () => {
      const data = await api<{ dashboards: DashboardSummary[] }>(
        `/app-api/chats/${encodeURIComponent(workspace.jid)}/dashboards`,
      );
      return data.dashboards || [];
    };

    const load = async () => {
      const [messagesData, runtimeData, dashboards] = await Promise.all([
        api<{ messages: Message[] }>(
          `/app-api/chats/${encodeURIComponent(workspace.jid)}/messages`,
        ),
        api<ChatRuntimeResponse>(
          `/app-api/chats/${encodeURIComponent(workspace.jid)}/runtime`,
        ),
        fetchDashboards(),
      ]);

      if (!active) return;
      setMessages(messagesData.messages || []);
      setRuntime(runtimeData);
      dashboardSnapshotRef.current = dashboards;
    };

    load().catch(console.error);

    const runtimeInterval = window.setInterval(() => {
      api<ChatRuntimeResponse>(
        `/app-api/chats/${encodeURIComponent(workspace.jid)}/runtime`,
      )
        .then((data) => {
          if (active) setRuntime(data);
        })
        .catch(() => undefined);
    }, 5000);

    const eventSource = new EventSource(
      `/app-api/chats/${encodeURIComponent(workspace.jid)}/events`,
      {
        withCredentials: true,
      },
    );

    eventSource.onopen = () => {
      if (active) setStreamStatus('live');
    };
    eventSource.onerror = () => {
      if (active) setStreamStatus('down');
    };
    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ChatEvent;
      if (payload.type !== 'message' || !payload.message || !active) return;

      const incoming = payload.message;
      setMessages((current) => mergeMessage(current, incoming));

      if (!(incoming.is_bot_message || incoming.is_from_me)) return;

      void (async () => {
        try {
          const previous = dashboardSnapshotRef.current;
          const next = await fetchDashboards();
          dashboardSnapshotRef.current = next;
          const actions = deriveMessageActions(previous, next);
          if (actions.length === 0 || !active) return;
          setMessageActions((current) => ({
            ...current,
            [incoming.id]: actions,
          }));
        } catch {
          // Leave the message visible even if dashboard diffing fails.
        }
      })();
    };

    return () => {
      active = false;
      window.clearInterval(runtimeInterval);
      eventSource.close();
    };
  }, [workspace?.jid]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace) return;
    if (!draft.trim() && files.length === 0) return;

    setSending(true);
    try {
      const path = `/app-api/chats/${encodeURIComponent(workspace.jid)}/messages`;
      const response =
        files.length > 0
          ? await api<{ message?: Message }>(path, {
              method: 'POST',
              body: (() => {
                const form = new FormData();
                if (draft.trim()) form.set('text', draft.trim());
                for (const file of files) {
                  form.append('files', file, file.name);
                }
                return form;
              })(),
            })
          : await api<{ message?: Message }>(path, {
              method: 'POST',
              body: JSON.stringify({ text: draft.trim() }),
            });

      if (response.message) {
        setMessages((current) => mergeMessage(current, response.message!));
      }
      setDraft('');
      setFiles([]);
      setFileInputKey((current) => current + 1);
    } finally {
      setSending(false);
    }
  };

  const publishDashboardForMessage = async (messageId: string) => {
    if (!workspace) return;
    setPublishingMessageId(messageId);
    try {
      const response = await api<{ dashboard: DashboardSummary }>(
        `/app-api/chats/${encodeURIComponent(workspace.jid)}/dashboards/publish-latest`,
        {
          method: 'POST',
        },
      );
      const dashboards = await api<{ dashboards: DashboardSummary[] }>(
        `/app-api/chats/${encodeURIComponent(workspace.jid)}/dashboards`,
      );
      dashboardSnapshotRef.current = dashboards.dashboards || [];
      setMessageActions((current) => ({
        ...current,
        [messageId]: [
          {
            kind: 'open_dashboard',
            slug: response.dashboard.slug,
            title: response.dashboard.title,
          },
        ],
      }));
    } finally {
      setPublishingMessageId(null);
    }
  };

  const agentState = runtime?.runtime?.active
    ? 'Agent is working'
    : runtime?.runtime?.waiting
      ? 'Workspace is queued'
      : 'Agent is idle';

  if (!workspace) {
    return <div className="empty-state">Choose or create a chat to get started.</div>;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>{workspace.title}</h2>
          <p className="lede">
            Messages flow through the `web` channel into the standard AgentOS
            queue and container runtime for this chat only.
          </p>
        </div>
        <div className="status-group">
          <div className="status-pill">{agentState}</div>
          <div className={`status-pill ${streamStatus}`}>Stream: {streamStatus}</div>
        </div>
      </header>

      <div className="chat-layout">
        <div className="panel message-panel">
          <div className="message-list">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message-card ${message.is_from_me ? 'me' : 'them'}`}
              >
                <header>
                  <strong>{message.sender_name}</strong>
                  <span>{formatTime(message.timestamp)}</span>
                </header>
                {message.content ? <p>{message.content}</p> : null}
                {message.attachments?.length ? (
                  <AttachmentChips
                    chatJid={workspace.jid}
                    attachments={message.attachments}
                  />
                ) : null}
                <MessageActionsRow
                  actions={messageActions[message.id] || []}
                  publishing={publishingMessageId === message.id}
                  onPublishDashboard={() => publishDashboardForMessage(message.id)}
                  onOpenDashboard={(slug) =>
                    onNavigate(buildChatPath(`/dashboards/${encodeURIComponent(slug)}`, workspace.jid))
                  }
                />
              </article>
            ))}
            {messages.length === 0 && (
              <div className="empty-state">This chat is ready for its first message.</div>
            )}
          </div>

          <form className="composer" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Send a message to your AgentOS workspace"
              rows={4}
            />
            <ComposerFileList
              files={files}
              onRemove={(index) =>
                setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
              }
            />
            <div className="composer-toolbar">
              <label className="secondary-button file-picker">
                Add files
                <input
                  key={fileInputKey}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files || []))
                  }
                />
              </label>
              <button className="primary-button" disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>

        <div className="panel runtime-panel">
          <h3>Runtime state</h3>
          <div className="stat-grid">
            <div className="stat-card">
              <span>Container</span>
              <strong>{runtime?.runtime?.containerName || '—'}</strong>
            </div>
            <div className="stat-card">
              <span>Pending tasks</span>
              <strong>{runtime?.runtime?.pendingTaskCount ?? 0}</strong>
            </div>
            <div className="stat-card">
              <span>Pending messages</span>
              <strong>{runtime?.runtime?.pendingMessages ? 'Yes' : 'No'}</strong>
            </div>
            <div className="stat-card">
              <span>Last agent cursor</span>
              <strong>{formatTime(runtime?.lastAgentTimestamp)}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SimpleMarkdown({ markdown }: { markdown: string }) {
  const blocks = markdown.split('\n').filter((line) => line.trim().length > 0);
  return (
    <div className="markdown-block">
      {blocks.map((line, index) => {
        if (line.startsWith('## ')) return <h4 key={index}>{line.slice(3)}</h4>;
        if (line.startsWith('# ')) return <h3 key={index}>{line.slice(2)}</h3>;
        if (line.startsWith('- ')) return <li key={index}>{line.slice(2)}</li>;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function ChartBlock({
  component,
}: {
  component: Extract<DashboardComponent, { type: 'chart' }>;
}) {
  const series = component.series[0];
  const max = Math.max(...series.points.map((point) => point.value), 1);
  const width = 520;
  const height = 220;
  const gap = width / Math.max(series.points.length, 1);

  if (component.chartType === 'bar') {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        {series.points.map((point, index) => {
          const barHeight = (point.value / max) * 160;
          return (
            <g key={point.label}>
              <rect
                x={index * gap + 20}
                y={height - barHeight - 30}
                width={Math.max(gap - 20, 20)}
                height={barHeight}
                rx={8}
              />
              <text x={index * gap + 24} y={height - 10}>
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const points = series.points
    .map((point, index) => {
      const x = index * gap + 24;
      const y = height - 30 - (point.value / max) * 160;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
      <polyline fill="none" strokeWidth="4" points={points} />
      {series.points.map((point, index) => {
        const x = index * gap + 24;
        const y = height - 30 - (point.value / max) * 160;
        return (
          <g key={point.label}>
            <circle cx={x} cy={y} r="6" />
            <text x={x - 12} y={height - 10}>
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ManifestDashboardRenderer({ dashboard }: { dashboard: DashboardManifest }) {
  return (
    <div className="dashboard-renderer">
      {dashboard.components.map((component, index) => {
        if (component.type === 'hero') {
          return (
            <section className="dashboard-hero" key={index}>
              {component.eyebrow && <p className="eyebrow">{component.eyebrow}</p>}
              <h2>{component.title}</h2>
              {component.subtitle && <p className="lede">{component.subtitle}</p>}
            </section>
          );
        }

        if (component.type === 'markdown') {
          return (
            <section className="dashboard-block" key={index}>
              {component.title && <h3>{component.title}</h3>}
              <SimpleMarkdown markdown={component.markdown} />
            </section>
          );
        }

        if (component.type === 'stats') {
          return (
            <section className="dashboard-block" key={index}>
              {component.title && <h3>{component.title}</h3>}
              <div className="stat-grid">
                {component.items.map((item) => (
                  <div className="stat-card" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail || item.trend || '—'}</small>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        if (component.type === 'table') {
          return (
            <section className="dashboard-block" key={index}>
              {component.title && <h3>{component.title}</h3>}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {component.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {component.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        }

        if (component.type === 'list') {
          return (
            <section className="dashboard-block" key={index}>
              {component.title && <h3>{component.title}</h3>}
              <div className="stack-list">
                {component.items.map((item) => (
                  <article className="stack-card" key={item.title}>
                    <header>
                      <strong>{item.title}</strong>
                      <span>{item.meta || '—'}</span>
                    </header>
                    {item.body && <p>{item.body}</p>}
                  </article>
                ))}
              </div>
            </section>
          );
        }

        if (component.type === 'timeline') {
          return (
            <section className="dashboard-block" key={index}>
              {component.title && <h3>{component.title}</h3>}
              <div className="timeline">
                {component.items.map((item) => (
                  <article className="timeline-item" key={`${item.label}-${item.timestamp}`}>
                    <strong>{item.label}</strong>
                    <span>{item.timestamp || '—'}</span>
                    {item.body && <p>{item.body}</p>}
                  </article>
                ))}
              </div>
            </section>
          );
        }

        return (
          <section className="dashboard-block" key={index}>
            {component.title && <h3>{component.title}</h3>}
            <ChartBlock component={component} />
          </section>
        );
      })}
    </div>
  );
}

function HtmlDashboardRenderer({
  dashboard,
  workspaceJid,
}: {
  dashboard: HtmlDashboardDocument;
  workspaceJid: string;
}) {
  return (
    <div className="dashboard-renderer">
      <section className="dashboard-hero">
        <p className="eyebrow">HTML Dashboard</p>
        <h2>{dashboard.title}</h2>
        {dashboard.description && <p className="lede">{dashboard.description}</p>}
      </section>
      <div className="dashboard-html-frame">
        <iframe
          title={dashboard.title}
          src={`/app-api/chats/${encodeURIComponent(workspaceJid)}/dashboards/${encodeURIComponent(
            dashboard.slug,
          )}/content`}
          sandbox=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}

function DashboardRenderer({
  dashboard,
  workspaceJid,
}: {
  dashboard: PublishedDashboardDocument;
  workspaceJid: string;
}) {
  if (dashboard.kind === 'html') {
    return <HtmlDashboardRenderer dashboard={dashboard} workspaceJid={workspaceJid} />;
  }

  return <ManifestDashboardRenderer dashboard={dashboard.manifest} />;
}

function DashboardsPage({
  workspace,
  pathname,
  onNavigate,
}: {
  workspace: WorkspaceSummary | null;
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [dashboard, setDashboard] = useState<PublishedDashboardDocument | null>(null);
  const selectedSlug = decodeURIComponent(pathname.split('/')[2] || '');

  useEffect(() => {
    if (!workspace) {
      setDashboards([]);
      setDashboard(null);
      return;
    }

    api<{ dashboards: DashboardSummary[] }>(
      `/app-api/chats/${encodeURIComponent(workspace.jid)}/dashboards`,
    )
      .then((data) => {
        const nextDashboards = data.dashboards || [];
        setDashboards(nextDashboards);
        if (!selectedSlug && nextDashboards[0]) {
          onNavigate(
            buildChatPath(
              `/dashboards/${encodeURIComponent(nextDashboards[0].slug)}`,
              workspace.jid,
            ),
          );
        }
      })
      .catch(console.error);
  }, [workspace?.jid, selectedSlug, onNavigate]);

  useEffect(() => {
    if (!workspace || !selectedSlug) {
      setDashboard(null);
      return;
    }

    api<{ dashboard: PublishedDashboardDocument }>(
      `/app-api/chats/${encodeURIComponent(workspace.jid)}/dashboards/${encodeURIComponent(
        selectedSlug,
      )}`,
    )
      .then((data) => setDashboard(data.dashboard))
      .catch(() => setDashboard(null));
  }, [workspace?.jid, selectedSlug]);

  if (!workspace) {
    return <div className="empty-state">Choose a chat to browse its dashboards.</div>;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboards</p>
          <h2>{workspace.title}</h2>
          <p className="lede">
            Structured manifests render natively, and HTML artifacts render in
            an isolated iframe sourced through the BFF.
          </p>
        </div>
      </header>

      <div className="dashboard-layout">
        <div className="panel">
          <h3>Published dashboards</h3>
          <div className="stack-list">
            {dashboards.map((entry) => (
              <button
                key={entry.slug}
                className={`dashboard-link ${
                  entry.slug === selectedSlug ? 'active' : ''
                }`}
                onClick={() =>
                  onNavigate(
                    buildChatPath(
                      `/dashboards/${encodeURIComponent(entry.slug)}`,
                      workspace.jid,
                    ),
                  )
                }
              >
                <strong>{entry.title}</strong>
                <span>{entry.description || 'No description'}</span>
                <small>
                  {describeDashboard(entry)} • {formatTime(entry.updatedAt)}
                </small>
              </button>
            ))}
            {dashboards.length === 0 && (
              <div className="empty-state">No dashboards have been published for this chat yet.</div>
            )}
          </div>
        </div>

        <div className="panel">
          {dashboard ? (
            <DashboardRenderer dashboard={dashboard} workspaceJid={workspace.jid} />
          ) : (
            <div className="empty-state">No dashboard selected yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminPage({
  session,
  search,
  replace,
}: {
  session: SessionUser;
  search: string;
  replace: (path: string) => void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [detail, setDetail] = useState<AdminWorkspaceDetail | null>(null);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [logs, setLogs] = useState<Array<{ level: string; msg: string; time: string }>>(
    [],
  );
  const selectedWorkspace = new URLSearchParams(search).get('workspace') || '';

  const load = async () => {
    const [overviewData, workspacesData, tasksData, logsData] = await Promise.all([
      api<AdminOverview>('/app-api/admin/overview'),
      api<{ workspaces: WorkspaceSummary[] }>('/app-api/admin/workspaces'),
      api<{ tasks: AdminTask[] }>('/app-api/admin/tasks'),
      api<{ logs: Array<{ level: string; msg: string; time: string }> }>(
        '/app-api/admin/logs?limit=20',
      ),
    ]);

    setOverview(overviewData);
    setWorkspaces(workspacesData.workspaces || []);
    setTasks(tasksData.tasks || []);
    setLogs(logsData.logs || []);

    const target = selectedWorkspace || workspacesData.workspaces?.[0]?.jid || '';
    if (!target) {
      setDetail(null);
      return;
    }

    if (!selectedWorkspace) {
      replace(`/admin?workspace=${encodeURIComponent(target)}`);
    }

    const detailData = await api<AdminWorkspaceDetail>(
      `/app-api/admin/workspaces/${encodeURIComponent(target)}`,
    );
    setDetail(detailData);
  };

  useEffect(() => {
    load().catch(console.error);
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selectedWorkspace]);

  const mutateTask = async (taskId: string, action: 'pause' | 'resume' | 'delete') => {
    const path =
      action === 'delete'
        ? `/app-api/admin/tasks/${encodeURIComponent(taskId)}`
        : `/app-api/admin/tasks/${encodeURIComponent(taskId)}/${action}`;
    await api(path, {
      method: action === 'delete' ? 'DELETE' : 'POST',
    });
    await load();
  };

  if (session.role === 'Viewer') {
    return <div className="empty-state">Operator or Admin access is required.</div>;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Cross-user operations console</h2>
          <p className="lede">
            Inspect all provisioned web chats, their dashboards, task state,
            and recent logs without exposing the private AgentOS API directly.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            api('/app-api/admin/channels/sync-groups', { method: 'POST' }).then(() => load())
          }
        >
          Sync groups
        </button>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span>Channels</span>
          <strong>{overview?.channels.connected ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span>Registered groups</span>
          <strong>{overview?.groups.registered ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span>Tasks</span>
          <strong>{overview?.tasks.total ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span>Recent errors</span>
          <strong>{overview?.logs.errorCount ?? 0}</strong>
        </div>
      </div>

      <div className="admin-layout">
        <div className="panel">
          <h3>Workspaces</h3>
          <div className="stack-list">
            {workspaces.map((workspace) => (
              <button
                key={workspace.jid}
                className={`dashboard-link ${
                  workspace.jid === selectedWorkspace ? 'active' : ''
                }`}
                onClick={() =>
                  replace(`/admin?workspace=${encodeURIComponent(workspace.jid)}`)
                }
              >
                <strong>{workspace.title}</strong>
                <span>
                  {workspace.displayName} • {workspace.email || workspace.userId}
                </span>
                <small>
                  {workspace.role} • {workspace.dashboardCount ?? 0} dashboards •{' '}
                  {workspace.taskCount ?? 0} tasks
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Workspace detail</h3>
          {detail ? (
            <div className="stack-list">
              <article className="stack-card">
                <header>
                  <strong>{detail.workspace.title}</strong>
                  <span>{detail.workspace.role}</span>
                </header>
                <p>
                  {detail.workspace.displayName} •{' '}
                  {detail.workspace.email || detail.workspace.userId}
                </p>
                <small>
                  Last login: {formatTime(detail.workspace.lastLoginAt)} • Last open:{' '}
                  {formatTime(detail.workspace.lastOpenedAt)}
                </small>
              </article>
              <article className="stack-card">
                <header>
                  <strong>Messages</strong>
                  <span>{detail.messages.length}</span>
                </header>
                <div className="mini-list">
                  {detail.messages.slice(-6).map((message) => (
                    <div key={message.id}>
                      <strong>{message.sender_name}</strong>: {message.content || 'Attachment-only message'}
                    </div>
                  ))}
                </div>
              </article>
              <article className="stack-card">
                <header>
                  <strong>Dashboards</strong>
                  <span>{detail.dashboards.length}</span>
                </header>
                <div className="mini-list">
                  {detail.dashboards.map((dashboard) => (
                    <div key={dashboard.slug}>
                      {dashboard.title} • {describeDashboard(dashboard)}
                    </div>
                  ))}
                </div>
              </article>
            </div>
          ) : (
            <div className="empty-state">Choose a workspace to inspect.</div>
          )}
        </div>
      </div>

      <div className="dashboard-layout">
        <div className="panel">
          <h3>Scheduled tasks</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Status</th>
                  <th>Next run</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.prompt.slice(0, 80)}</td>
                    <td>{task.status}</td>
                    <td>{formatTime(task.next_run)}</td>
                    <td className="action-row">
                      {task.status === 'active' && (
                        <button onClick={() => mutateTask(task.id, 'pause')}>
                          Pause
                        </button>
                      )}
                      {task.status === 'paused' && (
                        <button onClick={() => mutateTask(task.id, 'resume')}>
                          Resume
                        </button>
                      )}
                      {session.role === 'Admin' && (
                        <button
                          className="danger-button"
                          onClick={() => mutateTask(task.id, 'delete')}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Recent logs</h3>
          <div className="stack-list">
            {logs.map((log, index) => (
              <article className="stack-card" key={`${log.time}-${index}`}>
                <header>
                  <strong>{log.level.toUpperCase()}</strong>
                  <span>{formatTime(log.time)}</span>
                </header>
                <p>{log.msg}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const { pathname, search, navigate, replace } = useLocationState();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [chats, setChats] = useState<WorkspaceSummary[]>([]);
  const [creatingChat, setCreatingChat] = useState(false);

  const page = pathToPage(pathname);
  const chatParam = new URLSearchParams(search).get('chat') || '';
  const selectedChat =
    chats.find((chat) => chat.jid === chatParam) ||
    chats.find((chat) => chat.chatId === 'default') ||
    chats[0] ||
    null;

  const loadChats = async () => {
    const data = await api<{ chats: WorkspaceSummary[] }>('/app-api/chats');
    setChats(data.chats || []);
    return data.chats || [];
  };

  useEffect(() => {
    api<SessionResponse>('/app-api/auth/session')
      .then(setSession)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!session?.authenticated || !session.user) {
      setChats([]);
      return;
    }

    loadChats().catch(console.error);
  }, [session?.authenticated, session?.user?.tenantId, session?.user?.userId]);

  useEffect(() => {
    if (page === 'admin' || chats.length === 0) return;
    if (chatParam && chats.some((chat) => chat.jid === chatParam)) return;
    if (!selectedChat) return;
    replace(buildChatPath(pathname + search, selectedChat.jid));
  }, [page, chats, chatParam, selectedChat?.jid, pathname, search, replace]);

  const navigateWithSelectedChat = (targetPath: string) => {
    if (targetPath === '/admin') {
      navigate(targetPath);
      return;
    }
    navigate(buildChatPath(targetPath, selectedChat?.jid));
  };

  const handleSelectChat = (jid: string) => {
    if (page === 'dashboards') {
      navigate(buildChatPath('/dashboards', jid));
      return;
    }
    navigate(buildChatPath('/chat', jid));
  };

  const handleCreateChat = async () => {
    setCreatingChat(true);
    try {
      const response = await api<{ chat: WorkspaceSummary }>('/app-api/chats', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setChats((current) => mergeChatList(current, response.chat));
      navigate(buildChatPath('/chat', response.chat.jid));
      void loadChats();
    } finally {
      setCreatingChat(false);
    }
  };

  if (!session) {
    return <div className="loading-screen">Loading AgentOS Web…</div>;
  }

  if (!session.authenticated || !session.user) {
    return <LoginGate authMode={session.authMode} />;
  }

  return (
    <Shell
      page={page}
      session={session.user}
      chats={chats}
      selectedChatJid={selectedChat?.jid || ''}
      creatingChat={creatingChat}
      onNavigate={navigateWithSelectedChat}
      onSelectChat={handleSelectChat}
      onCreateChat={handleCreateChat}
    >
      {page === 'chat' && (
        <ChatPage workspace={selectedChat} onNavigate={navigate} />
      )}
      {page === 'dashboards' && (
        <DashboardsPage
          workspace={selectedChat}
          pathname={pathname}
          onNavigate={navigate}
        />
      )}
      {page === 'admin' && (
        <AdminPage session={session.user} search={search} replace={replace} />
      )}
    </Shell>
  );
}
