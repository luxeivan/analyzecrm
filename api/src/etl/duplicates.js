import { query, withTransaction } from '../db.js';
import { setServiceState } from './load.js';

/**
 * Полный расчёт кандидатов в дубли по эмбеддингам (100% записей с вектором).
 *
 * Запуск: node src/etl/duplicates.js [--threshold=0.9] [--only=company,contact,lead]
 *
 * Для каждой записи берётся ближайший сосед по HNSW-индексу; пары нормализуются
 * (a_id < b_id) и складываются в duplicate_pairs, поэтому отчёт открывается мгновенно.
 */

const args = process.argv.slice(2);
const thresholdArg = args.find((arg) => arg.startsWith('--threshold='));
const threshold = Math.min(0.999, Math.max(0.5, Number(thresholdArg?.slice('--threshold='.length)) || 0.9));
const only = args
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);

const ENTITIES = {
  company: 'companies',
  contact: 'contacts',
  lead: 'leads',
};

const state = {
  startedAt: new Date().toISOString(),
  updatedAt: null,
  finishedAt: null,
  error: null,
  threshold,
  byEntity: {},
};

async function persist() {
  state.updatedAt = new Date().toISOString();
  await setServiceState('duplicates', JSON.stringify(state)).catch(() => {});
}

async function runEntity(entity, table) {
  const startedAt = Date.now();
  console.log(`\n[duplicates] ${entity} (${table}) · порог ${threshold}`);

  // Без HNSW-индекса поиск соседа — полный скан таблицы на каждую запись (часы вместо секунд).
  await query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${table}_embedding_hnsw
       ON ${table} USING hnsw (embedding vector_cosine_ops)`,
  );

  await query(`DELETE FROM duplicate_pairs WHERE entity = $1`, [entity]);
  await persist();

  // Считаем пачками: длинная транзакция на всю таблицу не нужна, а прогресс виден в админке.
  // enable_seqscan=off заставляет планировщик использовать HNSW-индекс, иначе на таблицах
  // с частично заполненным embedding каждая строка уходит в полный скан.
  const BATCH = 5000;
  let lastId = 0;
  let insertedTotal = 0;

  while (true) {
    const result = await withTransaction(async (client) => {
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query(
        `WITH src AS (
           SELECT s.id, s.embedding
             FROM ${table} s
            WHERE s.embedding IS NOT NULL AND s.id > $3
            ORDER BY s.id
            LIMIT $4
         ), pairs AS (
           INSERT INTO duplicate_pairs (entity, a_id, b_id, score, computed_at)
           SELECT $1, LEAST(s.id, n.id), GREATEST(s.id, n.id),
                  1 - (s.embedding <=> n.embedding), now()
             FROM src s
             CROSS JOIN LATERAL (
               SELECT t.id, t.embedding
                 FROM ${table} t
                WHERE t.embedding IS NOT NULL AND t.id <> s.id
                ORDER BY t.embedding <=> s.embedding
                LIMIT 1
             ) n
            WHERE (s.embedding <=> n.embedding) <= $2
           ON CONFLICT (entity, a_id, b_id) DO NOTHING
           RETURNING 1
         )
         SELECT (SELECT count(*)::int FROM pairs) AS inserted,
                (SELECT coalesce(max(id), 0)::bigint FROM src) AS last_id`,
        [entity, 1 - threshold, lastId, BATCH],
      );
      return rows[0];
    });

    if (!Number(result.last_id)) break;
    lastId = Number(result.last_id);
    insertedTotal += result.inserted;
    state.byEntity[entity] = {
      ...(state.byEntity[entity] ?? {}),
      pairs: insertedTotal,
      processedId: lastId,
    };
    await persist();
    process.stdout.write(`
[duplicates] ${entity}: ${insertedTotal} пар · до id ${lastId}   `);
  }

  console.log('');
  const inserted = insertedTotal;

  const { rows: coverage } = await query(
    `SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM ${table}`,
  );

  const result = {
    pairs: inserted,
    total: coverage[0].total,
    embedded: coverage[0].embedded,
    tookMs: Date.now() - startedAt,
    computedAt: new Date().toISOString(),
  };
  state.byEntity[entity] = result;
  await persist();

  console.log(
    `[duplicates] ${entity}: ${result.pairs} пар · вектор есть у ${result.embedded}/${result.total} · ${Math.round(result.tookMs / 1000)} с`,
  );
}

async function main() {
  const keys = (only?.length ? only : Object.keys(ENTITIES)).filter((key) => ENTITIES[key]);
  await persist();

  for (const key of keys) {
    try {
      await runEntity(key, ENTITIES[key]);
    } catch (error) {
      console.error(`[duplicates] ${key}: ошибка — ${error.message}`);
      state.byEntity[key] = { error: error.message };
      state.error = error.message;
      await persist();
      process.exitCode = 1;
    }
  }

  state.finishedAt = new Date().toISOString();
  await persist();
  console.log('\n[duplicates] готово');
}

main().catch(async (error) => {
  console.error('[duplicates] ошибка:', error.message);
  state.error = error.message;
  state.finishedAt = new Date().toISOString();
  await persist();
  process.exit(1);
});
