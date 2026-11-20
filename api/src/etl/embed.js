import { query } from '../db.js';
import { embedTexts, embeddingBase, embeddingModel, embeddingToken } from '../embeddings.js';
import { setServiceState } from './load.js';

/**
 * Векторизация CRM через Polza.ai (OpenAI-совместимый /embeddings).
 *
 * Запуск:
 *   node src/etl/embed.js [--only=company,contact,deal,lead] [--limit=N] [--index] [--force]
 *
 * ENV:
 *   POLZA_TOKEN            — ключ polza.ai (обязателен)
 *   EMBEDDING_MODEL        — модель, по умолчанию openai/text-embedding-3-small
 *   EMBEDDING_BATCH        — размер батча, по умолчанию 32
 *   EMBEDDING_LIMIT        — максимум записей на сущность (для теста)
 *   EMBEDDING_INDEX=1      — создать HNSW-индексы после заполнения
 *   LLM_BASE_URL           — база API, по умолчанию https://polza.ai/api/v1
 *
 * Скрипт идемпотентен: берёт строки с embedding IS NULL, поэтому прерывание и
 * повторный запуск продолжают с места остановки. --force пересчитывает всё.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const token = embeddingToken;
const model = embeddingModel;
const base = embeddingBase;
const batchSize = Math.max(1, Number(process.env.EMBEDDING_BATCH || 32));
const limit = Number(process.env.EMBEDDING_LIMIT || 0) || null;
const withIndex = process.env.EMBEDDING_INDEX === '1';

const args = process.argv.slice(2);
const only = args
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const perEntityLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : limit;
const force = args.includes('--force');
const createIndex = withIndex || args.includes('--index');

if (!token) {
  console.error('Нужен POLZA_TOKEN в .env (ключ polza.ai).');
  process.exit(1);
}

const text = (value) => String(value ?? '').trim();

const listValues = (value) => {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => (typeof item === 'string' ? item : item?.value ?? item?.VALUE ?? ''))
    .map(text)
    .filter(Boolean)
    .join(', ');
};

const ENTITIES = {
  company: {
    table: 'companies',
    select: `SELECT c.id, c.title, c.industry_id, c.city, c.region, c.phones, c.emails,
                    c.raw->>'ADDRESS_CITY' AS addr_city,
                    c.raw->>'REG_ADDRESS_CITY' AS reg_city,
                    c.raw->>'ADDRESS_PROVINCE' AS province,
                    c.raw->>'WEB' AS site
               FROM companies c
              WHERE (c.embedding IS NULL OR c.embedded_at IS NULL OR c.embedded_at < coalesce(c.date_modify, 'epoch'::timestamptz))
              ORDER BY c.id
              LIMIT $1`,
    build: (row) =>
      [
        `Компания: ${text(row.title)}`,
        row.industry_id ? `Отрасль (ID): ${row.industry_id}` : '',
        row.city || row.addr_city || row.reg_city ? `Город: ${row.city || row.addr_city || row.reg_city}` : '',
        row.region || row.province ? `Регион: ${row.region || row.province}` : '',
        row.site ? `Сайт: ${row.site}` : '',
        listValues(row.phones) ? `Телефоны: ${listValues(row.phones)}` : '',
        listValues(row.emails) ? `Email: ${listValues(row.emails)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
  },
  contact: {
    table: 'contacts',
    select: `SELECT ct.id, ct.title, ct.name, ct.last_name, ct.company_id, ct.phones, ct.emails,
                    ct.raw->>'POST' AS position, c.title AS company_title
               FROM contacts ct
               LEFT JOIN companies c ON c.id = ct.company_id
              WHERE (ct.embedding IS NULL OR ct.embedded_at IS NULL OR ct.embedded_at < coalesce(ct.date_modify, 'epoch'::timestamptz))
              ORDER BY ct.id
              LIMIT $1`,
    build: (row) =>
      [
        `Контакт: ${text(row.title)}`,
        row.position ? `Должность: ${row.position}` : '',
        row.company_title ? `Компания: ${row.company_title}` : '',
        listValues(row.phones) ? `Телефоны: ${listValues(row.phones)}` : '',
        listValues(row.emails) ? `Email: ${listValues(row.emails)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
  },
  deal: {
    table: 'deals',
    select: `SELECT d.id, d.title, d.stage_id, d.category_id, d.opportunity, d.currency_id,
                    c.title AS company_title, ct.title AS contact_title
               FROM deals d
               LEFT JOIN companies c ON c.id = d.company_id
               LEFT JOIN contacts ct ON ct.id = d.contact_id
              WHERE (d.embedding IS NULL OR d.embedded_at IS NULL OR d.embedded_at < coalesce(d.date_modify, 'epoch'::timestamptz))
              ORDER BY d.id
              LIMIT $1`,
    build: (row) =>
      [
        `Сделка: ${text(row.title)}`,
        row.company_title ? `Компания: ${row.company_title}` : '',
        row.contact_title ? `Контакт: ${row.contact_title}` : '',
        row.stage_id ? `Стадия (ID): ${row.stage_id}` : '',
        row.opportunity ? `Сумма: ${row.opportunity} ${row.currency_id || ''}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
  },
  lead: {
    table: 'leads',
    select: `SELECT l.id, l.title, l.status_id, l.source_id, l.opportunity, l.currency_id,
                    l.phones, l.emails, c.title AS company_title, ct.title AS contact_title
               FROM leads l
               LEFT JOIN companies c ON c.id = l.company_id
               LEFT JOIN contacts ct ON ct.id = l.contact_id
              WHERE (l.embedding IS NULL OR l.embedded_at IS NULL OR l.embedded_at < coalesce(l.date_modify, 'epoch'::timestamptz))
              ORDER BY l.id
              LIMIT $1`,
    build: (row) =>
      [
        `Лид: ${text(row.title)}`,
        row.company_title ? `Компания: ${row.company_title}` : '',
        row.contact_title ? `Контакт: ${row.contact_title}` : '',
        row.status_id ? `Статус (ID): ${row.status_id}` : '',
        row.source_id ? `Источник (ID): ${row.source_id}` : '',
        listValues(row.phones) ? `Телефоны: ${listValues(row.phones)}` : '',
        listValues(row.emails) ? `Email: ${listValues(row.emails)}` : '',
        row.opportunity ? `Сумма: ${row.opportunity} ${row.currency_id || ''}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
  },
};

/** Обёртка над общим клиентом: возвращает {data:[{embedding}]} как раньше. */
async function embedBatch(inputs) {
  const { embeddings, usage } = await embedTexts(inputs, { attempts: 5 });
  return { data: embeddings.map((embedding) => ({ embedding })), usage };
}

async function createIndexes() {
  const entities = only?.length ? only : Object.keys(ENTITIES);
  for (const key of entities) {
    const { table } = ENTITIES[key];
    console.log(`[index] ${table}: HNSW (vector_cosine_ops)`);
    await query(
      `CREATE INDEX IF NOT EXISTS ${table}_embedding_hnsw
         ON ${table} USING hnsw (embedding vector_cosine_ops)`,
    );
  }
}

/** Прогресс для UI: пишем в service_state, API отдаёт его через /api/embed/status. */
const progress = {
  model,
  startedAt: new Date().toISOString(),
  updatedAt: null,
  finishedAt: null,
  error: null,
  tokens: 0,
  costRub: 0,
  entities: [],
};

let lastPersist = 0;

async function persistProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastPersist < 1500) return;
  lastPersist = now;

  const processed = progress.entities.reduce((sum, row) => sum + row.processed, 0);
  const total = progress.entities.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const elapsedSec = Math.max(1, Math.round((now - new Date(progress.startedAt).getTime()) / 1000));
  const rate = processed / elapsedSec;

  progress.updatedAt = new Date().toISOString();
  progress.processed = processed;
  progress.total = total || null;
  progress.rate = Number(rate.toFixed(1));
  progress.etaSec =
    rate > 0 && total > processed ? Math.round((total - processed) / rate) : processed >= total ? 0 : null;

  await setServiceState('embed', JSON.stringify(progress)).catch(() => {});
}

async function main() {
  const keys = (only?.length ? only : Object.keys(ENTITIES)).filter((key) => ENTITIES[key]);
  if (!keys.length) {
    console.error('Неизвестные сущности. Доступно: company, contact, deal, lead');
    process.exit(1);
  }

  console.log(`[embed] модель ${model} · база ${base} · батч ${batchSize}${force ? ' · force' : ''}`);

  let grandTotal = 0;
  let grandTokens = 0;
  let grandCost = 0;

  // заранее считаем объём по всем сущностям, чтобы общая шкала была честной с первой секунды
  progress.entities = [];
  for (const key of keys) {
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS c FROM ${ENTITIES[key].table} WHERE embedding IS NULL`,
    );
    progress.entities.push({
      entity: key,
      processed: 0,
      total: perEntityLimit ? Math.min(perEntityLimit, countRows[0].c) : countRows[0].c,
      done: false,
    });
  }
  await persistProgress(true);

  for (const key of keys) {
    const entity = ENTITIES[key];
    const row = progress.entities.find((item) => item.entity === key);
    let processed = 0;
    let tokens = 0;
    let cost = 0;
    const startedAt = Date.now();
    const target = perEntityLimit;

    row.done = false;

    console.log(
      `\n[embed] ${key} (${entity.table}): ${row.total} записей без вектора${target ? ` · лимит ${target}` : ''}`,
    );
    if (force) {
      await query(`UPDATE ${entity.table} SET embedding = NULL`);
      console.log(`[embed] ${key}: embedding сброшен (force)`);
    }

    while (true) {
      const take = target ? Math.min(batchSize, target - processed) : batchSize;
      if (take <= 0) break;

      const { rows } = await query(entity.select, [take]);
      if (!rows.length) break;

      const inputs = rows.map((row) => entity.build(row).slice(0, 6000));
      const data = await embedBatch(inputs);

      const dims = data.data[0]?.embedding?.length;
      if (dims !== 1536) {
        throw new Error(
          `модель вернула ${dims} измерений, а схема ждёт vector(1536). Используйте text-embedding-3-small или измените схему.`,
        );
      }

      // Обновляем по id (порядок эмбеддингов соответствует порядку rows).
      for (let i = 0; i < rows.length; i += 1) {
        await query(`UPDATE ${entity.table} SET embedding = $1::vector, embedded_at = now() WHERE id = $2`, [
          `[${data.data[i].embedding.join(',')}]`,
          rows[i].id,
        ]);
      }

      processed += rows.length;
      tokens += data.usage?.total_tokens ?? 0;
      cost += data.usage?.cost_rub ?? data.usage?.cost ?? 0;

      row.processed = processed;
      progress.tokens = grandTokens + tokens;
      progress.costRub = Number((grandCost + cost).toFixed(4));
      await persistProgress();

      if (processed % (batchSize * 10) === 0 || rows.length < take) {
        const elapsed = (Date.now() - startedAt) / 1000;
        console.log(
          `[embed] ${key}: ${processed}${target ? `/${target}` : ''} · ${elapsed.toFixed(0)}s · ` +
            `${(processed / Math.max(elapsed, 1)).toFixed(1)}/с · ${tokens} ток. · ${cost.toFixed(2)} ₽`,
        );
      }

      if (target && processed >= target) break;
      await sleep(150);
    }

    row.done = true;
    row.processed = processed;
    await persistProgress(true);
    console.log(
      `[embed] ${key}: готово ${processed} записей, ${tokens} токенов, ${cost.toFixed(2)} ₽`,
    );
    grandTotal += processed;
    grandTokens += tokens;
    grandCost += cost;
  }

  console.log(
    `\n[embed] ИТОГО: ${grandTotal} записей, ${grandTokens} токенов, ${grandCost.toFixed(2)} ₽`,
  );

  if (createIndex) {
    console.log('[embed] создаём HNSW-индексы…');
    await createIndexes();
    console.log('[embed] HNSW-индексы созданы');
  }

  progress.finishedAt = new Date().toISOString();
  progress.total = progress.processed;
  progress.etaSec = 0;
  await persistProgress(true);
}

main().catch(async (error) => {
  console.error('[embed] ошибка:', error.message);
  progress.error = error.message;
  progress.finishedAt = new Date().toISOString();
  await persistProgress(true);
  process.exit(1);
});
