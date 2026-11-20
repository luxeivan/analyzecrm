import { withTransaction } from '../db.js';

// Лимит параметров PostgreSQL — 65535. Делим с запасом.
const MAX_PARAMS = 60_000;

/**
 * Пакетная запись страницы API (50 записей) прямо в БД.
 * Никакого накопления в памяти: страница пришла -> записали -> забыли.
 */
export async function insertPage(entity, rows, sync) {
  if (!rows.length) return;

  await withTransaction(async (client) => {
    const { columns } = entity;
    const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / columns.length));

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const params = [];
      const tuples = chunk.map(
        (row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`,
      );
      const updates = columns
        .filter((col) => col !== 'id')
        .map((col) => `${col} = EXCLUDED.${col}`)
        .join(', ');

      await client.query(
        `INSERT INTO ${entity.table} (${columns.join(', ')})
         VALUES ${tuples.join(', ')}
         ON CONFLICT (id) DO UPDATE SET ${updates}`,
        params,
      );
    }

    if (sync) {
      await client.query(
        `INSERT INTO sync_state (entity, total, last_id, fetched, status, last_error, last_run)
         VALUES ($1, $2, $3, $4, 'running', NULL, now())
         ON CONFLICT (entity) DO UPDATE SET
           total     = COALESCE(EXCLUDED.total, sync_state.total),
           last_id   = GREATEST(sync_state.last_id, EXCLUDED.last_id),
           fetched   = sync_state.fetched + EXCLUDED.fetched,
           status    = 'running',
           last_error = NULL,
           last_run  = now()`,
        [entity.key, sync.total, sync.lastId, sync.fetched],
      );
    }
  });
}

export async function resetCursor(entityKey) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO sync_state (entity, last_id, fetched, status, last_run)
       VALUES ($1, 0, 0, 'idle', now())
       ON CONFLICT (entity) DO UPDATE SET
         last_id = 0, fetched = 0, status = 'idle', last_error = NULL, last_run = now()`,
      [entityKey],
    );
  });
}

export async function getCursor(entityKey) {
  const { rows } = await withTransaction(async (client) =>
    client.query('SELECT last_id FROM sync_state WHERE entity = $1', [entityKey]),
  );
  return Number(rows[0]?.last_id ?? 0);
}

export async function markSync(entityKey, status, error = null) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO sync_state (entity, status, last_error, last_run)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (entity) DO UPDATE SET
         status = EXCLUDED.status, last_error = EXCLUDED.last_error, last_run = now()`,
      [entityKey, status, error ? String(error).slice(0, 2000) : null],
    );
  });
}

/** Курсор дельты по DATE_MODIFY (последняя успешная синхронизация правок). */
export async function getModifiedCursor(entityKey) {
  const { rows } = await withTransaction(async (client) =>
    client.query('SELECT last_modified FROM sync_state WHERE entity = $1', [entityKey]),
  );
  return rows[0]?.last_modified ?? null;
}

export async function setModifiedCursor(entityKey, timestamp) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO sync_state (entity, last_modified, last_run)
       VALUES ($1, $2, now())
       ON CONFLICT (entity) DO UPDATE SET
         last_modified = EXCLUDED.last_modified,
         last_run = now()`,
      [entityKey, timestamp],
    );
  });
}

export async function getServiceState(key) {
  const { rows } = await withTransaction(async (client) =>
    client.query('SELECT value FROM service_state WHERE key = $1', [key]),
  );
  return rows[0]?.value ?? null;
}

export async function setServiceState(key, value) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO service_state (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, String(value)],
    );
  });
}
