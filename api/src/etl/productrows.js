import { config } from '../config.js';
import { call, sleep } from '../bitrix.js';
import { query, withTransaction } from '../db.js';
import {
  DEAL_PRODUCT_ROW_COLUMNS,
  transformProductRow,
} from './transform.js';
import {
  getCursor,
  getModifiedCursor,
  markSync,
  resetCursor,
  setModifiedCursor,
} from './load.js';

/**
 * Состав сделок: crm.deal.productrows.get.
 *
 * Метод работает только по одной сделке, поэтому используем batch —
 * до 30 сделок за HTTP-запрос (лимит Битрикса 50, держим запас).
 * Список ID берём из уже выгруженной таблицы deals (keyset по ID),
 * так что дополнительных запросов к crm.deal.list не нужно.
 */
const ENTITY = 'deal_products';
const BATCH = 30;
const MAX_TUPLES = 400;

const noop = () => {};

const upsertSyncState = (client, lastId, fetched) =>
  client.query(
    `INSERT INTO sync_state (entity, last_id, fetched, status, last_run)
     VALUES ($1, $2, $3, 'running', now())
     ON CONFLICT (entity) DO UPDATE SET
       last_id = GREATEST(sync_state.last_id, EXCLUDED.last_id),
       fetched = sync_state.fetched + EXCLUDED.fetched,
       status = 'running',
       last_error = NULL,
       last_run = now()`,
    [ENTITY, lastId, fetched],
  );

/** Запись строк нескольких сделок: строки сделки перезаписываются целиком. */
async function saveRows(dealIds, rowsByDeal, lastId) {
  // Удаляем строки только тех сделок, по которым реально получен ответ:
  // иначе неудачный batch-вызов стёр бы уже выгруженный состав сделки.
  const known = dealIds.filter((dealId) => rowsByDeal.has(dealId));

  await withTransaction(async (client) => {
    if (known.length) {
      await client.query('DELETE FROM deal_product_rows WHERE deal_id = ANY($1::bigint[])', [known]);
    }

    const insertable = dealIds
      .map((dealId) => rowsByDeal.get(dealId))
      .filter((rows) => Array.isArray(rows) && rows.length);

    const tuples = insertable.flat();
    for (let i = 0; i < tuples.length; i += MAX_TUPLES) {
      const chunk = tuples.slice(i, i + MAX_TUPLES);
      const params = [];
      const values = chunk.map(
        (row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`,
      );
      const updates = DEAL_PRODUCT_ROW_COLUMNS.filter((col) => !['deal_id', 'line_id'].includes(col))
        .map((col) => `${col} = EXCLUDED.${col}`)
        .join(', ');

      await client.query(
        `INSERT INTO deal_product_rows (${DEAL_PRODUCT_ROW_COLUMNS.join(', ')})
         VALUES ${values.join(', ')}
         ON CONFLICT (deal_id, line_id) DO UPDATE SET ${updates}`,
        params,
      );
    }

    if (lastId) await upsertSyncState(client, lastId, dealIds.length);
  });
}

/** Один batch-запрос по списку сделок -> Map(dealId -> rows[]). */
async function fetchRows(dealIds) {
  const cmd = {};
  dealIds.forEach((dealId, index) => {
    cmd[`p${index}`] = `crm.deal.productrows.get?id=${dealId}`;
  });

  const res = await call('batch', { halt: 0, cmd });
  const payload = res?.result?.result || {};
  const errors = res?.result?.result_error || {};
  const rowsByDeal = new Map();
  const failed = [];

  dealIds.forEach((dealId, index) => {
    const raw = payload[`p${index}`];
    if (!Array.isArray(raw)) {
      const error = errors[`p${index}`];
      failed.push({ dealId, error: error?.error_description || error?.error || 'нет данных' });
      return;
    }
    rowsByDeal.set(dealId, raw.map((row, rowIndex) => transformProductRow(dealId, row, rowIndex)));
  });

  return { rowsByDeal, failed };
}

/**
 * Полная (или продолженная) выгрузка состава сделок.
 * Курсор — последний обработанный ID сделки в sync_state('deal_products').
 */
export async function loadDealProductRows({ full = false, control = null, onEvent = noop, limit = null } = {}) {
  if (full) await resetCursor(ENTITY);
  const resumeFrom = await getCursor(ENTITY);

  await markSync(ENTITY, 'running');
  onEvent({ type: 'entity-start', entity: ENTITY, resumeFrom, selectCount: 1, limit: limit || null });

  const startedAt = Date.now();
  let cursor = resumeFrom;
  let deals = 0;
  let failedCount = 0;
  let page = 0;

  for (;;) {
    if (limit && deals >= limit) break;
    if (control?.check) await control.check();

    const take = limit ? Math.min(BATCH, limit - deals) : BATCH;
    const { rows } = await query(
      'SELECT id FROM deals WHERE id > $1 ORDER BY id ASC LIMIT $2',
      [cursor, take],
    );
    if (!rows.length) break;

    const dealIds = rows.map((row) => Number(row.id));
    const { rowsByDeal, failed } = await fetchRows(dealIds);
    failedCount += failed.length;
    if (failed.length) {
      console.warn(`[etl][${ENTITY}] не удалось получить строки у ${failed.length} сделок`, failed.slice(0, 3));
    }

    const lastId = dealIds[dealIds.length - 1];
    await saveRows(dealIds, rowsByDeal, lastId);

    cursor = lastId;
    deals += dealIds.length;
    page += 1;

    onEvent({ type: 'page', entity: ENTITY, page, lastId, total: null, fetched: deals });
    await sleep(config.sleepMs);
  }

  const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  await markSync(ENTITY, 'done');
  await setModifiedCursor(ENTITY, new Date(startedAt).toISOString());
  onEvent({ type: 'entity-done', entity: ENTITY, fetched: deals, seconds, lastId: cursor, total: null });
  return { fetched: deals, failed: failedCount, lastId: cursor };
}

/**
 * Дельта: обновляем строки только у сделок, изменённых после курсора
 * (сделка могла сменить состав товаров, сумму или стадию).
 */
export async function refreshProductRows({ control = null, onEvent = noop, overlapMinutes } = {}) {
  const stored = await getModifiedCursor(ENTITY);
  const overlap = Number(overlapMinutes ?? process.env.ETL_MODIFIED_OVERLAP_MIN ?? 5);
  const since = stored
    ? new Date(new Date(stored).getTime() - overlap * 60_000)
    : new Date(Date.now() - 7 * 86_400_000);
  const runStartedAt = new Date();

  onEvent({ type: 'modified-start', entity: ENTITY, since: since.toISOString() });

  const startedAt = Date.now();
  let cursor = 0;
  let deals = 0;
  let failedCount = 0;
  let page = 0;

  for (;;) {
    if (control?.check) await control.check();

    const { rows } = await query(
      `SELECT id FROM deals
        WHERE date_modify >= $1 AND id > $2
        ORDER BY id ASC LIMIT $3`,
      [since.toISOString(), cursor, BATCH],
    );
    if (!rows.length) break;

    const dealIds = rows.map((row) => Number(row.id));
    const { rowsByDeal, failed } = await fetchRows(dealIds);
    failedCount += failed.length;
    await saveRows(dealIds, rowsByDeal, null);

    cursor = dealIds[dealIds.length - 1];
    deals += dealIds.length;
    page += 1;

    onEvent({ type: 'modified-page', entity: ENTITY, page, fetched: deals, total: null });
    await sleep(config.sleepMs);
  }

  await setModifiedCursor(ENTITY, runStartedAt.toISOString());
  onEvent({
    type: 'modified-done',
    entity: ENTITY,
    fetched: deals,
    total: null,
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  });
  return { fetched: deals, failed: failedCount };
}
