export interface MultiValue {
  value: string;
  type: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface CompanyRow {
  id: number;
  title: string;
  industry_id: string | null;
  industry: string | null;
  source_id: string | null;
  source: string | null;
  city: string | null;
  region: string | null;
  assigned_by_id: number | null;
  phones: MultiValue[];
  emails: MultiValue[];
  date_create: string | null;
  date_modify: string | null;
}

export interface ContactRow {
  id: number;
  title: string;
  company_id: number | null;
  company_title: string | null;
  position: string | null;
  source: string | null;
  phones: MultiValue[];
  emails: MultiValue[];
  date_create: string | null;
  date_modify: string | null;
}

export interface DealRow {
  id: number;
  title: string;
  company_id: number | null;
  company_title: string | null;
  contact_id: number | null;
  contact_title: string | null;
  stage_id: string | null;
  stage: string | null;
  opportunity: number | null;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
}

export interface ProfileField {
  code: string;
  label: string;
  type: string;
  isCustom: boolean;
  value: string;
}

export interface CompanyDetail {
  id: number;
  title: string;
  industry: string | null;
  source: string | null;
  city: string | null;
  region: string | null;
  phones: MultiValue[];
  emails: MultiValue[];
  date_create: string | null;
  date_modify: string | null;
  synced_at: string | null;
  fields: ProfileField[];
  contacts: ContactRow[];
  deals: DealRow[];
  products: CompanyProduct[];
  deals_total: { count: number; won: number; open: number; sum: number; open_sum: number };
  raw: Record<string, unknown>;
}

export interface ContactDeal {
  id: number;
  title: string;
  stage_id: string | null;
  stage: string | null;
  opportunity: number | null;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
}

export interface ContactDetail {
  id: number;
  title: string;
  name: string | null;
  last_name: string | null;
  second_name: string | null;
  company_id: number | null;
  company: { id: number; title: string; industry_id: string | null; city: string | null } | null;
  source: string | null;
  phones: MultiValue[];
  emails: MultiValue[];
  date_create: string | null;
  date_modify: string | null;
  fields: ProfileField[];
  deals: ContactDeal[];
  deals_total: { count: number; won: number; open: number; sum: number; open_sum: number };
  raw: Record<string, unknown>;
}

export interface LeadRow {
  id: number;
  title: string;
  company_id: number | null;
  company_title: string | null;
  contact_id: number | null;
  contact_title: string | null;
  status_id: string | null;
  status: string | null;
  source_id: string | null;
  source: string | null;
  opportunity: number | null;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
}

export interface LeadDetail {
  id: number;
  title: string;
  name: string | null;
  last_name: string | null;
  second_name: string | null;
  company_id: number | null;
  company: { id: number; title: string; city: string | null } | null;
  contact_id: number | null;
  contact: { id: number; title: string; phones: MultiValue[]; emails: MultiValue[] } | null;
  status_id: string | null;
  status: string | null;
  source_id: string | null;
  source: string | null;
  opportunity: number | null;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
  synced_at: string | null;
  fields: ProfileField[];
  raw: Record<string, unknown>;
}

export interface DealDetail {
  id: number;
  title: string;
  company_id: number | null;
  contact_id: number | null;
  stage_id: string | null;
  stage: string | null;
  category_id: string | null;
  opportunity: number | null;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
  company?: { id: number; title: string; city: string | null } | null;
  contact?: { id: number; title: string; phones: MultiValue[]; emails: MultiValue[] } | null;
  products: DealProductRow[];
  products_total: { lines: number; qty: number; sum: number; discount: number };
  fields: ProfileField[];
  raw: Record<string, unknown>;
}

export interface FieldDef {
  code: string;
  label: string;
  type: string;
  isCustom: boolean;
  isMultiple: boolean;
  items: { id: string; value: string }[];
}

export interface StatPoint {
  key: string | null;
  name: string;
  value: number;
}

export interface Stats {
  totals: { companies: number; contacts: number; deals: number; leads: number };
  quality: {
    contacts_without_company: number;
    companies_without_contacts: number;
    companies_without_city: number;
    open_deals: number;
    leads_without_company: number;
  };
  segmentField: string;
  segments: StatPoint[];
  sources: StatPoint[];
  cities: StatPoint[];
  stages: StatPoint[];
  leadStages: StatPoint[];
  timeline: { name: string; value: number }[];
}

export interface GraphNode {
  id: string;
  entity: 'company' | 'contact' | 'deal';
  entityId: number;
  label: string;
  type: 'company' | 'contact' | 'deal';
  stage?: string | null;
  size?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type SyncStatusValue =
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'done'
  | 'error';

export interface SyncStatus {
  status: SyncStatusValue;
  full: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  entity: string | null;
  page: number;
  lastId: number;
  total: number | null;
  fetched: number;
  message: string | null;
  error: string | null;
  progress?: {
    entity: string;
    status: 'pending' | 'running' | 'done' | 'error' | 'delta';
    fetched: number;
    total: number | null;
    lastId: number;
    error: string | null;
  }[];
  log: string[];
}

export interface SyncState {
  entity: string;
  total: number | null;
  last_id: number;
  fetched: number;
  status: string;
  last_error: string | null;
  last_run: string | null;
}

export interface AnalyticsCoverage {
  entity: 'company' | 'contact' | 'deal' | 'lead';
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface AnalyticsRecommendation {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  action: string;
}

export interface AdminOverview {
  uptimeSec: number;
  node: string;
  memoryMb: number;
  postgres: { version: string; sizeBytes: number };
  tables: { table: string; rows: number; embedded: number; fresh: number }[];
  vectorIndexes: { table: string; index: string }[];
  deletedRecords: number;
  embed: EmbedStatus | null;
  lastReconcile: { finishedAt?: string; deleted?: number; error?: string | null } | null;
  sync: SyncStatus;
  settings: {
    sleepMs: number;
    pageLimit: number;
    maxRetries: number;
    autoRetry: number;
    entityPauseMs: number;
    syncScheduler: boolean;
    syncIntervalMin: number;
    reconcileDays: number;
    embeddingModel: string;
    bitrixConfigured: boolean;
  };
}

export interface Analytics {
  period?: { from: string | null; to: string | null };
  generatedAt: string;
  dataAsOf: string | null;
  coverage: AnalyticsCoverage[];
  deals: {
    count: number;
    won: number;
    lost: number;
    open: number;
    zeroSum: number;
    sum: number;
    wonSum: number;
    lostSum: number;
    avgDeal: number;
    winRate: number;
    stages: { key: string; name: string; count: number; sum: number }[];
  };
  years: { year: string; count: number; won: number; won_sum: number; sum: number }[];
  months: { month: string; count: number; won_sum: number; sum: number }[];
  leads: {
    count: number;
    converted: number;
    junk: number;
    conversion: number;
    sum: number;
    byStatus: StatPoint[];
  };
  sources: {
    key: string;
    name: string;
    total: number;
    converted: number;
    junk: number;
    conversion: number;
  }[];
  topCompanies: { id: number; title: string; deals: number; sum: number }[];
  cities: { city: string; companies: number; sum: number }[];
  repeat: {
    companies: number;
    repeatCompanies: number;
    totalSum: number;
    repeatSum: number;
    share: number;
  };
  quality: {
    companies: {
      total: number;
      no_city: number;
      no_industry: number;
      no_source: number;
      no_phone_exported: number;
      no_email_exported: number;
      no_contacts: number;
    };
    contacts: {
      total: number;
      no_company: number;
      company_not_loaded: number;
      no_phone_exported: number;
      no_email_exported: number;
      no_position: number;
    };
    leads: {
      total: number;
      no_company: number;
      company_not_loaded: number;
      no_contact: number;
      no_source: number;
    };
    deals: {
      total: number;
      no_company: number;
      no_contact: number;
      zero_sum: number;
      open: number;
      without_begin_date: number;
      contact_not_loaded: number;
      company_not_loaded: number;
    };
    duplicates: {
      company_title_groups: number;
      company_title_rows: number;
      contact_name_groups: number;
      contact_name_rows: number;
    };
  };
  recommendations: AnalyticsRecommendation[];
}

export interface AiInsights {
  configured: boolean;
  provider?: string;
  model?: string;
  text?: string;
  hint?: string;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    reasoningTokens?: number | null;
    costRub?: number | null;
  } | null;
}

export interface EmbedStatus {
  active: boolean;
  model?: string;
  startedAt?: string;
  updatedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  processed?: number;
  total?: number | null;
  rate?: number;
  etaSec?: number | null;
  tokens?: number;
  costRub?: number;
  entities?: { entity: string; processed: number; total: number | null; done: boolean }[];
}

export interface SemanticItem {
  id: number;
  title: string | null;
  score: number;
}

export interface SemanticSearchResult {
  entity: string;
  q: string;
  model?: string;
  items: SemanticItem[];
}

export interface SimilarResult {
  entity: string;
  id: string;
  items: SemanticItem[];
  reason?: string;
}

export type SearchEntity = 'company' | 'contact' | 'deal' | 'lead';

export interface LookalikeItem {
  id: number;
  title: string | null;
  city: string | null;
  region: string | null;
  won_sum: number;
  score: number;
  similar_to?: string | null;
  similar_to_score?: number | null;
}

export interface LookalikeResult {
  top: number;
  items: LookalikeItem[];
}

export interface AiAskSource {
  entity: 'company' | 'deal' | 'lead';
  id: number;
  title: string | null;
  score: number;
}

export interface AiAskResult {
  configured: boolean;
  hint?: string;
  provider?: string;
  model?: string;
  answer?: string;
  usage?: AiInsights['usage'];
  sources?: AiAskSource[];
}

export interface DuplicatesSummaryRow {
  entity: 'company' | 'contact' | 'lead';
  label: string;
  pairs: number;
  total: number;
  embedded: number;
  computedAt: string | null;
}

export interface DuplicatesSummary {
  threshold: number;
  computedAt: string | null;
  running: boolean;
  byEntity: DuplicatesSummaryRow[];
}

export interface DuplicateSide {
  id: number;
  title: string | null;
  extra: string | null;
  status: string | null;
}

export interface DuplicatePair {
  a: DuplicateSide;
  b: DuplicateSide;
  score: number;
  aStatusName?: string;
  bStatusName?: string;
}

export interface DuplicatePairsPage {
  entity: string;
  threshold: number;
  page: number;
  limit: number;
  total: number;
  items: DuplicatePair[];
}

export interface DuplicateRecord {
  id: number;
  title: string | null;
  statusName?: string;
  fields: { key: string; label: string; value: string }[];
}

export interface DuplicatePairDetails {
  a: DuplicateRecord | null;
  b: DuplicateRecord | null;
}

export interface DuplicateGroupRecordRef {
  id: number;
  title: string | null;
  extra?: string | null;
}

export interface DuplicateGroupItem {
  key: number;
  size: number;
  minScore: number;
  maxScore: number;
  records: DuplicateGroupRecordRef[];
}

export interface DuplicateGroupsPage {
  entity: string;
  threshold: number;
  page: number;
  limit: number;
  total: number;
  recordsInGroups: number;
  exactGroups: number;
  items: DuplicateGroupItem[];
}

export interface DuplicateDeal {
  id: number;
  title: string | null;
  opportunity: number;
  stageName: string;
  date_create: string | null;
}

export interface DuplicateGroupRecord {
  id: number;
  title: string | null;
  statusName: string | null;
  fields: { key: string; label: string; value: string }[];
  deals: { count: number; sum: number; won_sum: number; items: DuplicateDeal[] };
}

export interface DuplicateGroupDetails {
  entity: string;
  records: DuplicateGroupRecord[];
}

export interface AuthUser {
  id: number;
  login: string;
  name: string | null;
  role: 'admin' | 'user';
  active: boolean;
  isSystem: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Товары и отчёты по продажам
// ---------------------------------------------------------------------------
export interface CompanyProduct {
  id: number;
  name: string | null;
  qty: number;
  revenue: number;
  deals: number;
  last_at: string | null;
}

export interface DealProductRow {
  id: number | null;
  name: string | null;
  quantity: number;
  price: number;
  revenue: number;
  discount: number;
  measure_name: string | null;
  in_catalog: boolean;
  section_id: number | null;
  section_name: string | null;
}

export interface ProductRow {
  id: number;
  name: string | null;
  section_id: number | null;
  price: number | null;
  currency_id: string | null;
  measure: string | null;
  active: boolean;
  qty: number;
  revenue: number;
  deals: number;
  companies: number;
}

export interface ProductSection {
  id: number;
  name: string | null;
  parent_id: number | null;
  sort: number | null;
  products: number;
}

export interface ProductTimelinePoint {
  period: string;
  revenue: number;
  qty: number;
  deals: number;
}

export interface ProductTopRow {
  id: number;
  name: string | null;
  section_id: number | null;
  qty: number;
  revenue: number;
  deals: number;
  companies: number;
}

export interface ProductAnalytics {
  period: { from: string | null; to: string | null; group: string };
  stage: 'won' | 'all';
  totals: { revenue: number; qty: number; deals: number; companies: number; products: number };
  topProducts: ProductTopRow[];
  topSections: { id: number; name: string | null; revenue: number; qty: number; deals: number }[];
  timeline: ProductTimelinePoint[];
}

export interface ProductReportCompany {
  id: number;
  title: string | null;
  city: string | null;
  industry: string | null;
  source: string | null;
  industry_id: string | null;
  source_id: string | null;
  revenue: number;
  qty: number;
  deals: number;
  won_deals: number;
  contacts: number;
  first_at: string | null;
  last_at: string | null;
}

export interface ProductReportDeal {
  deal_id: number;
  deal_title: string | null;
  stage_id: string | null;
  stage: string | null;
  company_id: number | null;
  opportunity: number | null;
  quantity: number;
  revenue: number;
  date_create: string | null;
}

export interface ProductReport {
  product: {
    id: number;
    name: string | null;
    section_id: number | null;
    section_path: { id: number; name: string | null }[];
    price: number | null;
    currency_id: string | null;
    measure: string | null;
    active: boolean;
  };
  period: { from: string | null; to: string | null; group: string };
  stage: 'won' | 'all';
  totals: {
    revenue: number;
    qty: number;
    discount: number;
    deals: number;
    companies: number;
    first_at: string | null;
    last_at: string | null;
  };
  timeline: (ProductTimelinePoint & { companies: number })[];
  companies: ProductReportCompany[];
  deals: ProductReportDeal[];
}
