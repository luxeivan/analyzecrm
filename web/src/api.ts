import type {
  Analytics,
  AiInsights,
  CompanyDetail,
  CompanyRow,
  ContactDetail,
  ContactRow,
  DealDetail,
  DealRow,
  EmbedStatus,
  AdminOverview,
  SemanticSearchResult,
  SimilarResult,
  SearchEntity,
  LookalikeResult,
  AiAskResult,
  DuplicatesSummary,
  DuplicatePairsPage,
  DuplicatePairDetails,
  DuplicateGroupsPage,
  DuplicateGroupDetails,
  FieldDef,
  GraphData,
  LeadDetail,
  LeadRow,
  Page,
  Stats,
  SyncState,
  SyncStatus,
  AuthUser,
} from './types';

const BASE = '/api';

export const TOKEN_KEY = 'crm-analyzer-token';
export const AUTH_EVENT = 'crm-auth-unauthorized';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export type Params = Record<string, string | number | boolean | null | undefined>;

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function handleUnauthorized(status: number) {
  if (status !== 401) return;
  setToken(null);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

async function request<T>(path: string, method: string, body?: unknown, params?: Params): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    handleUnauthorized(response.status);
    const payload = await response.json().catch(() => null);
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const get = <T,>(path: string, params?: Params) => request<T>(path, 'GET', undefined, params);
const post = <T,>(path: string, body?: unknown) => request<T>(path, 'POST', body ?? {});
const patch = <T,>(path: string, body?: unknown) => request<T>(path, 'PATCH', body ?? {});
const del = <T,>(path: string) => request<T>(path, 'DELETE');

export const api = {
  stats: (segment?: string) => get<Stats>('/stats/overview', { segment }),
  sync: () => get<{ items: SyncState[] }>('/stats/sync'),
  syncStatus: () => get<SyncStatus>('/sync/status'),
  syncStart: (full = false) => post<SyncStatus>('/sync/start', { full }),
  syncPause: () => post<SyncStatus>('/sync/pause'),
  syncResume: () => post<SyncStatus>('/sync/resume'),
  syncStop: () => post<SyncStatus>('/sync/stop'),
  fields: (entity = 'company') => get<{ entity: string; fields: FieldDef[] }>('/fields', { entity }),

  companies: (params: Params) => get<Page<CompanyRow>>('/companies', params),
  company: (id: string | number) => get<CompanyDetail>(`/companies/${id}`),
  contacts: (params: Params) => get<Page<ContactRow>>('/contacts', params),
  contact: (id: string | number) => get<ContactDetail>(`/contacts/${id}`),
  deals: (params: Params) => get<Page<DealRow>>('/deals', params),
  deal: (id: string | number) => get<DealDetail>(`/deals/${id}`),
  leads: (params: Params) => get<Page<LeadRow>>('/leads', params),
  lead: (id: string | number) => get<LeadDetail>(`/leads/${id}`),

  graphCompany: (id: string | number) => get<GraphData>(`/graph/company/${id}`),
  graphOverview: (limit = 25) => get<GraphData>('/graph/overview', { limit }),

  aiSummary: (id: string | number) => get<Record<string, unknown>>(`/ai/company/${id}/summary`),
  aiInsights: () => post<AiInsights>('/ai/insights'),

  analytics: (params: { from?: string; to?: string } = {}) =>
    get<Analytics>('/analytics/overview', { from: params.from, to: params.to }),
  embedStatus: () => get<EmbedStatus>('/embed/status'),
  adminOverview: () => get<AdminOverview>('/admin/overview'),
  adminAction: (name: 'embed' | 'reconcile') => post<{ started: boolean }>(`/admin/actions/${name}`),

  semanticSearch: (entity: SearchEntity, q: string, limit = 20) =>
    get<SemanticSearchResult>('/search/semantic', { entity, q, limit }),
  similar: (entity: SearchEntity, id: string | number, limit = 8) =>
    get<SimilarResult>(`/similar/${entity}/${id}`, { limit }),
  lookalike: (limit = 25, top = 50) => get<LookalikeResult>('/search/lookalike', { limit, top }),
  aiAsk: (question: string) => post<AiAskResult>('/ai/ask', { question }),

  duplicatesSummary: () => get<DuplicatesSummary>('/duplicates/summary'),
  duplicatesPairs: (entity: string, params: { threshold?: number; page?: number; limit?: number } = {}) =>
    get<DuplicatePairsPage>(`/duplicates/${entity}`, params),
  duplicatePair: (entity: string, a: number, b: number) =>
    get<DuplicatePairDetails>(`/duplicates/${entity}/pair`, { a, b }),
  duplicatesRun: (threshold = 0.9) => post<{ started: boolean }>('/duplicates/run', { threshold }),

  login: (login: string, password: string) =>
    post<{ token: string; user: AuthUser }>('/auth/login', { login, password }),
  me: () => get<AuthUser>('/auth/me'),
  users: () => get<{ items: AuthUser[] }>('/users'),
  createUser: (data: { login: string; password: string; name?: string; role?: 'admin' | 'user' }) =>
    post<AuthUser>('/users', data),
  updateUser: (id: number, data: { name?: string; role?: 'admin' | 'user'; active?: boolean; password?: string }) =>
    patch<AuthUser>(`/users/${id}`, data),
  deleteUser: (id: number) => del<{ deleted: boolean }>(`/users/${id}`),
  duplicatesGroups: (entity: string, params: { threshold?: number; page?: number; limit?: number } = {}) =>
    get<DuplicateGroupsPage>(`/duplicates/${entity}/groups`, params),
  duplicatesGroup: (entity: string, ids: number[]) =>
    get<DuplicateGroupDetails>(`/duplicates/${entity}/group`, { ids: ids.join(',') }),
};
