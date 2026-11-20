-- Схема создаётся идемпотентно: и ETL, и API могут вызвать её при старте.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Нормализованные таблицы (быстрый поиск/фильтры/сортировки)
-- raw JSONB — полный ответ API: ничего не теряем, схема остаётся гибкой.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id             BIGINT PRIMARY KEY,
  title          TEXT,
  industry_id    TEXT,
  source_id      TEXT,
  assigned_by_id BIGINT,
  city           TEXT,
  region         TEXT,
  phones         JSONB NOT NULL DEFAULT '[]'::jsonb,
  emails         JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_text    TEXT NOT NULL DEFAULT '',
  raw            JSONB NOT NULL,
  embedding      vector(1536),
  date_create    TIMESTAMPTZ,
  date_modify    TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_search_trgm ON companies USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_title_trgm  ON companies USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_raw_gin     ON companies USING gin (raw jsonb_path_ops);
CREATE INDEX IF NOT EXISTS companies_industry    ON companies (industry_id);
CREATE INDEX IF NOT EXISTS companies_source      ON companies (source_id);
CREATE INDEX IF NOT EXISTS companies_city        ON companies (city);
CREATE INDEX IF NOT EXISTS companies_modified    ON companies (date_modify DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS contacts (
  id             BIGINT PRIMARY KEY,
  title          TEXT,
  name           TEXT,
  last_name      TEXT,
  second_name    TEXT,
  company_id     BIGINT,
  source_id      TEXT,
  assigned_by_id BIGINT,
  phones         JSONB NOT NULL DEFAULT '[]'::jsonb,
  emails         JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_text    TEXT NOT NULL DEFAULT '',
  raw            JSONB NOT NULL,
  embedding      vector(1536),
  date_create    TIMESTAMPTZ,
  date_modify    TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_search_trgm ON contacts USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_raw_gin     ON contacts USING gin (raw jsonb_path_ops);
CREATE INDEX IF NOT EXISTS contacts_company     ON contacts (company_id);
CREATE INDEX IF NOT EXISTS contacts_source      ON contacts (source_id);
CREATE INDEX IF NOT EXISTS contacts_modified    ON contacts (date_modify DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS deals (
  id             BIGINT PRIMARY KEY,
  title          TEXT,
  company_id     BIGINT,
  contact_id     BIGINT,
  stage_id       TEXT,
  category_id    TEXT,
  opportunity    NUMERIC(18, 2),
  currency_id    TEXT,
  assigned_by_id BIGINT,
  search_text    TEXT NOT NULL DEFAULT '',
  raw            JSONB NOT NULL,
  embedding      vector(1536),
  date_create    TIMESTAMPTZ,
  date_modify    TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_search_trgm ON deals USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS deals_raw_gin     ON deals USING gin (raw jsonb_path_ops);
CREATE INDEX IF NOT EXISTS deals_company     ON deals (company_id);
CREATE INDEX IF NOT EXISTS deals_contact     ON deals (contact_id);
CREATE INDEX IF NOT EXISTS deals_stage       ON deals (stage_id);

CREATE TABLE IF NOT EXISTS leads (
  id             BIGINT PRIMARY KEY,
  title          TEXT,
  name           TEXT,
  last_name      TEXT,
  second_name    TEXT,
  company_id     BIGINT,
  contact_id     BIGINT,
  status_id      TEXT,
  source_id      TEXT,
  opportunity    NUMERIC(18, 2),
  currency_id    TEXT,
  assigned_by_id BIGINT,
  search_text    TEXT NOT NULL DEFAULT '',
  raw            JSONB NOT NULL,
  embedding      vector(1536),
  date_create    TIMESTAMPTZ,
  date_modify    TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_search_trgm ON leads USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_raw_gin     ON leads USING gin (raw jsonb_path_ops);
CREATE INDEX IF NOT EXISTS leads_company     ON leads (company_id);
CREATE INDEX IF NOT EXISTS leads_contact     ON leads (contact_id);
CREATE INDEX IF NOT EXISTS leads_status      ON leads (status_id);
CREATE INDEX IF NOT EXISTS leads_source      ON leads (source_id);

-- ---------------------------------------------------------------------------
-- Метаданные полей CRM: includes UF_* с типами и вариантами справочников
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitrix_fields (
  entity      TEXT NOT NULL,
  field_code  TEXT NOT NULL,
  field_name  TEXT,
  type        TEXT,
  is_custom   BOOLEAN NOT NULL DEFAULT false,
  is_multiple BOOLEAN NOT NULL DEFAULT false,
  items       JSONB,
  raw         JSONB,
  PRIMARY KEY (entity, field_code)
);

-- Расшифровка enumeration: companies.raw->>'UF_CRM_123' = '861' -> 'Опт'
CREATE TABLE IF NOT EXISTS bitrix_enum (
  entity     TEXT NOT NULL,
  field_code TEXT NOT NULL,
  enum_id    TEXT NOT NULL,
  value      TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, field_code, enum_id)
);

-- Статусы/стадии/источники из crm.status.list (SOURCE_ID, STAGE_ID, INDUSTRY, ...)
CREATE TABLE IF NOT EXISTS crm_status (
  entity_id TEXT NOT NULL,
  status_id TEXT NOT NULL,
  name      TEXT,
  semantics TEXT, -- S = успех, F = провал (crm.status.list)
  sort      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_id, status_id)
);

-- Инкрементальный курсор: последний успешно записанный ID по сущности
-- Мягкие миграции для уже существующих БД
ALTER TABLE crm_status   ADD COLUMN IF NOT EXISTS semantics TEXT;
ALTER TABLE bitrix_fields ADD COLUMN IF NOT EXISTS is_multiple BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sync_state (
  entity     TEXT PRIMARY KEY,
  total      INTEGER,
  last_id    BIGINT NOT NULL DEFAULT 0,
  fetched    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  last_run   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Дельта по DATE_MODIFY, инкрементальная векторизация, служебное состояние
-- ---------------------------------------------------------------------------
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_modified TIMESTAMPTZ;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE deals     ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE leads     ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_embedded ON companies (embedded_at);
CREATE INDEX IF NOT EXISTS contacts_embedded  ON contacts (embedded_at);
CREATE INDEX IF NOT EXISTS deals_embedded     ON deals (embedded_at);
CREATE INDEX IF NOT EXISTS leads_embedded     ON leads (embedded_at);

CREATE TABLE IF NOT EXISTS service_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Аудит удалённых в CRM записей (сверка ID раз в неделю)
CREATE TABLE IF NOT EXISTS deleted_records (
  entity     TEXT NOT NULL,
  id         BIGINT NOT NULL,
  title      TEXT,
  raw        JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, id)
);

-- Кандидаты в дубли: ближайший сосед по эмбеддингу выше порога (пересчитывается скриптом duplicates.js)
CREATE TABLE IF NOT EXISTS duplicate_pairs (
  entity      TEXT NOT NULL,
  a_id        BIGINT NOT NULL,
  b_id        BIGINT NOT NULL,
  score       REAL NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, a_id, b_id)
);

CREATE INDEX IF NOT EXISTS duplicate_pairs_entity_score ON duplicate_pairs (entity, score DESC);

-- Пользователи панели: роль admin/user, пароли — scrypt(pass$salt$hash)
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_system     BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Каталог товаров (crm.product / crm.productsection) и состав сделок
-- (crm.deal.productrows.get). Цены и количества берутся из строки сделки:
-- это историческая цена на момент продажи, а не текущая цена карточки товара.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_sections (
  id         BIGINT PRIMARY KEY,
  name       TEXT,
  parent_id  BIGINT,
  sort       INTEGER,
  raw        JSONB NOT NULL,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_sections_parent ON product_sections (parent_id);
CREATE INDEX IF NOT EXISTS product_sections_name_trgm ON product_sections USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS products (
  id          BIGINT PRIMARY KEY,
  name        TEXT,
  section_id  BIGINT,
  price       NUMERIC(18, 4),
  currency_id TEXT,
  measure     TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  code        TEXT,
  vat_id      BIGINT,
  description TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  raw         JSONB NOT NULL,
  date_create TIMESTAMPTZ,
  date_modify TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_section   ON products (section_id);
CREATE INDEX IF NOT EXISTS products_active    ON products (active);
CREATE INDEX IF NOT EXISTS products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_search_trgm ON products USING gin (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS deal_product_rows (
  deal_id       BIGINT NOT NULL,
  line_id       BIGINT NOT NULL,
  product_id    BIGINT,
  product_name  TEXT,
  price         NUMERIC(18, 4),
  price_netto   NUMERIC(18, 4),
  price_account NUMERIC(18, 4),
  quantity      NUMERIC(18, 4),
  discount_sum  NUMERIC(18, 4),
  discount_rate NUMERIC(18, 4),
  tax_rate      NUMERIC(18, 4),
  measure_name  TEXT,
  type          SMALLINT,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, line_id)
);
CREATE INDEX IF NOT EXISTS deal_product_rows_product ON deal_product_rows (product_id);
