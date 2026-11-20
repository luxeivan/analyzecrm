import { Router } from 'express';
import { embedTexts, embeddingModel, embeddingsConfigured, toVectorLiteral } from '../../embeddings.js';
import { query } from '../../db.js';

export const searchRouter = Router();

/** Белый список сущностей: имя в API -> таблица и подпись. */
const ENTITIES = {
  company: { table: 'companies', label: 'компании' },
  contact: { table: 'contacts', label: 'контакты' },
  deal: { table: 'deals', label: 'сделки' },
  lead: { table: 'leads', label: 'лиды' },
};

const LIMIT_MAX = 50;

const clampLimit = (value, fallback = 20) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(LIMIT_MAX, Math.round(n)) : fallback;
};

const round = (value) => Math.round(Number(value) * 10000) / 10000;

/** GET /api/search/semantic?q=...&entity=company&limit=20 — поиск по смыслу. */
searchRouter.get('/search/semantic', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const entity = String(req.query.entity ?? 'company');
    const meta = ENTITIES[entity];
    if (!meta) return res.status(400).json({ error: 'Неизвестная сущность', entities: Object.keys(ENTITIES) });
    if (q.length < 3) return res.status(400).json({ error: 'Запрос короче 3 символов' });
    if (!embeddingsConfigured) {
      return res.status(503).json({ error: 'Эмбеддинги не настроены', hint: 'Задайте POLZA_TOKEN в .env' });
    }

    const { embeddings: [vector] } = await embedTexts([q.slice(0, 6000)]);
    const literal = toVectorLiteral(vector);
    const limit = clampLimit(req.query.limit);

    const { rows } = await query(
      `SELECT id, title,
              round((1 - (embedding <=> $1::vector))::numeric, 4)::float8 AS score
         FROM ${meta.table}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [literal, limit],
    );

    res.json({
      entity,
      q,
      model: embeddingModel,
      items: rows.map((row) => ({ ...row, score: round(row.score) })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/similar/:entity/:id?limit=8 — ближайшие соседи записи по вектору. */
searchRouter.get('/similar/:entity/:id', async (req, res, next) => {
  try {
    const entity = String(req.params.entity);
    const meta = ENTITIES[entity];
    if (!meta) return res.status(400).json({ error: 'Неизвестная сущность', entities: Object.keys(ENTITIES) });

    const limit = clampLimit(req.query.limit, 8);
    const { rows } = await query(
      `WITH src AS (
         SELECT embedding FROM ${meta.table} WHERE id = $1 AND embedding IS NOT NULL
       )
       SELECT t.id, t.title,
              round((1 - (t.embedding <=> src.embedding))::numeric, 4)::float8 AS score
         FROM ${meta.table} t, src
        WHERE t.embedding IS NOT NULL AND t.id <> $1
        ORDER BY t.embedding <=> src.embedding
        LIMIT $2`,
      [req.params.id, limit],
    );

    if (!rows.length) {
      const { rows: check } = await query(
        `SELECT 1 FROM ${meta.table} WHERE id = $1 AND embedding IS NOT NULL`,
        [req.params.id],
      );
      if (!check.length) return res.json({ entity, id: req.params.id, items: [], reason: 'no_embedding' });
    }

    res.json({ entity, id: req.params.id, items: rows.map((row) => ({ ...row, score: round(row.score) })) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/search/duplicates?entity=company&threshold=0.9&sample=2000 — пары похожих записей (кандидаты в дубли). */
searchRouter.get('/search/duplicates', async (req, res, next) => {
  try {
    const entity = String(req.query.entity ?? 'company');
    const meta = ENTITIES[entity];
    if (!meta) return res.status(400).json({ error: 'Неизвестная сущность', entities: Object.keys(ENTITIES) });

    const threshold = Math.min(0.995, Math.max(0.5, Number(req.query.threshold) || 0.9));
    const sample = Math.min(5000, Math.max(100, Number(req.query.sample) || 2000));
    const distance = 1 - threshold;

    const startedAt = Date.now();
    const { rows } = await query(
      `WITH src AS (
         SELECT id, title, embedding
           FROM ${meta.table}
          WHERE embedding IS NOT NULL
          ORDER BY id DESC
          LIMIT $1
       )
       SELECT s.id AS a_id, s.title AS a_title,
              n.id AS b_id, n.title AS b_title,
              round((1 - (s.embedding <=> n.embedding))::numeric, 4)::float8 AS score
         FROM src s
         CROSS JOIN LATERAL (
           SELECT t.id, t.title, t.embedding
             FROM ${meta.table} t
            WHERE t.embedding IS NOT NULL AND t.id <> s.id
            ORDER BY t.embedding <=> s.embedding
            LIMIT 1
         ) n
        WHERE (s.embedding <=> n.embedding) <= $2
        ORDER BY score DESC
        LIMIT 300`,
      [sample, distance],
    );

    // убираем зеркальные пары (a→b и b→a) и дубли по ключу
    const seen = new Set();
    const items = [];
    for (const row of rows) {
      const key = row.a_id < row.b_id ? `${row.a_id}:${row.b_id}` : `${row.b_id}:${row.a_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...row, score: round(row.score) });
    }

    res.json({
      entity,
      threshold,
      sample,
      scanned: sample,
      tookMs: Date.now() - startedAt,
      items,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/search/lookalike?limit=25&top=50 — компании, похожие на лучших клиентов.
 * Центроид = средний вектор top-N компаний с максимальной суммой успешных сделок.
 * Уже купившие (есть WON) исключаются.
 */
searchRouter.get('/search/lookalike', async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 25);
    const top = Math.min(300, Math.max(5, Number(req.query.top) || 50));

    const { rows } = await query(
      `WITH best AS (
         SELECT c.id, c.title, c.embedding
           FROM companies c
           JOIN deals d ON d.company_id = c.id AND d.stage_id = 'WON'
          WHERE c.embedding IS NOT NULL
          GROUP BY c.id, c.title, c.embedding
          ORDER BY sum(d.opportunity) DESC NULLS LAST
          LIMIT $2
       ),
       centroid AS (SELECT avg(embedding)::vector AS vec FROM best)
       SELECT c.id, c.title, c.city, c.region,
              round((1 - (c.embedding <=> (SELECT vec FROM centroid)))::numeric, 4)::float8 AS score,
              nb.title AS similar_to,
              round(nb.similarity::numeric, 4)::float8 AS similar_to_score
         FROM companies c
         CROSS JOIN centroid
         CROSS JOIN LATERAL (
           SELECT b.title, 1 - (c.embedding <=> b.embedding) AS similarity
             FROM best b
            ORDER BY b.embedding <=> c.embedding
            LIMIT 1
         ) nb
        WHERE c.embedding IS NOT NULL
          AND c.id NOT IN (SELECT id FROM best)
          AND NOT EXISTS (
            SELECT 1 FROM deals d WHERE d.company_id = c.id AND d.stage_id = 'WON'
          )
        ORDER BY c.embedding <=> (SELECT vec FROM centroid)
        LIMIT $1`,
      [limit, top],
    );

    res.json({
      top,
      items: rows.map((row) => ({ ...row, score: round(row.score) })),
    });
  } catch (err) {
    next(err);
  }
});
