import { WEBAPP_INTERNAL_BASE_URL, WEB_INTERNAL_API_TOKEN } from '../config.js';
import {
  DashboardSummary,
  PublishedDashboardDocument,
} from '../web/dashboards.js';
import { WebWorkspaceIdentity } from '../types.js';

async function fetchInternal(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (
    !headers.has('Content-Type') &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json');
  }
  if (WEB_INTERNAL_API_TOKEN) {
    headers.set('X-AgentOS-Internal-Token', WEB_INTERNAL_API_TOKEN);
  }

  return fetch(`${WEBAPP_INTERNAL_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Internal API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function ensureWorkspaceForUser(input: {
  tenantId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: string;
}): Promise<WebWorkspaceIdentity> {
  const response = await fetchInternal('/api/internal/workspaces/ensure', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const json = await readJson<{ workspace: WebWorkspaceIdentity }>(response);
  return json.workspace;
}

export async function getOwnedWorkspaces(input: {
  tenantId: string;
  userId: string;
}): Promise<WebWorkspaceIdentity[]> {
  const params = new URLSearchParams({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  const response = await fetchInternal(
    `/api/internal/workspaces?${params.toString()}`,
  );
  const json = await readJson<{ workspaces: WebWorkspaceIdentity[] }>(response);
  return json.workspaces;
}

export async function createWorkspaceChat(input: {
  tenantId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: string;
  title?: string;
}): Promise<WebWorkspaceIdentity> {
  const response = await fetchInternal('/api/internal/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const json = await readJson<{ workspace: WebWorkspaceIdentity }>(response);
  return json.workspace;
}

export async function markWorkspaceOpened(
  jid: string,
): Promise<Record<string, unknown>> {
  return readJson(
    await fetchInternal(
      `/api/internal/workspaces/${encodeURIComponent(jid)}/open`,
      {
        method: 'POST',
      },
    ),
  );
}

export async function postWorkspaceMessage(input: {
  jid: string;
  body: NonNullable<RequestInit['body']>;
  headers?: RequestInit['headers'];
}): Promise<unknown> {
  const response = await fetchInternal(
    `/api/internal/workspaces/${encodeURIComponent(input.jid)}/messages`,
    {
      method: 'POST',
      body: input.body,
      headers: input.headers,
    },
  );
  return readJson(response);
}

export async function publishLatestWorkspaceDashboard(
  jid: string,
): Promise<DashboardSummary> {
  const response = await fetchInternal(
    `/api/internal/workspaces/${encodeURIComponent(jid)}/dashboards/publish-latest`,
    {
      method: 'POST',
    },
  );
  const json = await readJson<{ dashboard: DashboardSummary }>(response);
  return json.dashboard;
}

export async function getWorkspaceAttachmentContent(
  jid: string,
  attachmentId: string,
): Promise<Response> {
  return fetchInternal(
    `/api/internal/workspaces/${encodeURIComponent(jid)}/attachments/${encodeURIComponent(attachmentId)}/content`,
    {
      headers: {
        Accept: '*/*',
      },
    },
  );
}

export async function getWorkspaceDetail(
  jid: string,
): Promise<Record<string, unknown>> {
  const response = await fetchInternal(
    `/api/workspaces/${encodeURIComponent(jid)}`,
  );
  return readJson(response);
}

export async function getWorkspaceMessages(
  jid: string,
  limit: number = 100,
  before?: string,
): Promise<{ messages: unknown[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  const response = await fetchInternal(
    `/api/groups/${encodeURIComponent(jid)}/messages?${params.toString()}`,
  );
  return readJson(response);
}

export async function getWorkspaceRuntime(
  jid: string,
): Promise<Record<string, unknown>> {
  const response = await fetchInternal(
    `/api/groups/${encodeURIComponent(jid)}/runtime`,
  );
  return readJson(response);
}

export async function getWorkspaceDashboards(
  jid: string,
): Promise<DashboardSummary[]> {
  const response = await fetchInternal(
    `/api/workspaces/${encodeURIComponent(jid)}/dashboards`,
  );
  const json = await readJson<{ dashboards: DashboardSummary[] }>(response);
  return json.dashboards;
}

export async function getWorkspaceDashboard(
  jid: string,
  slug: string,
): Promise<PublishedDashboardDocument> {
  const response = await fetchInternal(
    `/api/workspaces/${encodeURIComponent(jid)}/dashboards/${encodeURIComponent(slug)}`,
  );
  const json = await readJson<{ dashboard: PublishedDashboardDocument }>(
    response,
  );
  return json.dashboard;
}

export async function getWorkspaceDashboardContent(
  jid: string,
  slug: string,
): Promise<Response> {
  return fetchInternal(
    `/api/workspaces/${encodeURIComponent(jid)}/dashboards/${encodeURIComponent(slug)}/content`,
    {
      headers: {
        Accept: 'text/html',
      },
    },
  );
}

export async function getWorkspaceEventStream(jid: string): Promise<Response> {
  return fetchInternal(`/api/workspaces/${encodeURIComponent(jid)}/events`, {
    headers: {
      Accept: 'text/event-stream',
    },
  });
}

export async function getAdminOverview(): Promise<Record<string, unknown>> {
  return readJson(await fetchInternal('/api/overview'));
}

export async function getAdminChannels(): Promise<Record<string, unknown>> {
  return readJson(await fetchInternal('/api/channels'));
}

export async function getAdminRuntime(): Promise<Record<string, unknown>> {
  return readJson(await fetchInternal('/api/runtime'));
}

export async function getAdminTasks(): Promise<Record<string, unknown>> {
  return readJson(await fetchInternal('/api/tasks'));
}

export async function getAdminLogs(
  limit: number = 100,
): Promise<Record<string, unknown>> {
  return readJson(await fetchInternal(`/api/logs?limit=${limit}`));
}

export async function getAdminWorkspaces(): Promise<{
  workspaces: WebWorkspaceIdentity[];
}> {
  return readJson(await fetchInternal('/api/workspaces'));
}

export async function syncGroups(): Promise<Record<string, unknown>> {
  return readJson(
    await fetchInternal('/api/channels/sync-groups', { method: 'POST' }),
  );
}

export async function pauseTask(
  taskId: string,
): Promise<Record<string, unknown>> {
  return readJson(
    await fetchInternal(`/api/tasks/${encodeURIComponent(taskId)}/pause`, {
      method: 'POST',
    }),
  );
}

export async function resumeTask(
  taskId: string,
): Promise<Record<string, unknown>> {
  return readJson(
    await fetchInternal(`/api/tasks/${encodeURIComponent(taskId)}/resume`, {
      method: 'POST',
    }),
  );
}

export async function deleteTaskById(
  taskId: string,
): Promise<Record<string, unknown>> {
  return readJson(
    await fetchInternal(`/api/tasks/${encodeURIComponent(taskId)}/delete`, {
      method: 'DELETE',
    }),
  );
}
