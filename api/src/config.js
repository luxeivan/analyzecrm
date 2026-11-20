import 'dotenv/config';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 4000),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://bitrix:bitrix@localhost:5432/bitrix',

  // Входящий вебхук Битрикс24: https://portal.bitrix24.ru/rest/1/token
  bitrixWebhookUrl: (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/+$/, ''),

  // Ограничения REST Битрикс24
  pageLimit: num(process.env.ETL_PAGE_SIZE, 50),
  sleepMs: num(process.env.ETL_SLEEP_MS, 500),
  maxRetries: num(process.env.ETL_MAX_RETRIES, 5),
  requestTimeoutMs: num(process.env.ETL_REQUEST_TIMEOUT_MS, 55000),
  entityPauseMs: num(process.env.ETL_ENTITY_PAUSE_MS, 2000),

  // Какое поле считать "регионом". Пусто — берём ADDRESS_CITY/ADDRESS_PROVINCE.
  regionField: process.env.REGION_FIELD || '',

  // Планировщик и обслуживание (см. server/scheduler.js, etl/reconcile.js)
  syncScheduler: process.env.SYNC_SCHEDULER === '1',
  syncIntervalMin: num(process.env.SYNC_INTERVAL_MIN, 15),
  reconcileDays: num(process.env.RECONCILE_DAYS, 7),
  autoRetry: num(process.env.ETL_AUTO_RETRY, 10),
  embeddingModel: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
};
