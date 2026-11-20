import { Router } from 'express';
import { query } from '../../db.js';
import { decodeEnum, decodeStatus, getMeta } from '../crm.js';

export const statsRouter = Router();

const FIELD = /^[A-Za-z0-9_]+$/;

function decodeStage(meta, statusId) {
  if (!statusId) return null;
  for (const [key, name] of meta.statuses) {
    if (key.startsWith('DEAL_STAGE') && key.endsWith(`|${statusId}`)) return name;
  }
  return decodeStatus(meta, statusId);
}

const pairs = (rows, decode) =>
  rows.map((row) => ({ key: row.key, name: decode(row.key) ?? 'Не указано', value: Number(row.value) }));

/** Агрегаты для дашборда: сегменты, источники, география, стадии, динамика. */
statsRouter.get('/stats/overview', async (req, res, next) => {
  try {
    const meta = await getMeta();
    const segmentField = FIELD.test(String(req.query.segment || ''))
      ? String(req.query.segment)
      : 'INDUSTRY';

    const [totals, quality, segments, sources, cities, stages, leadStages, timeline] = await Promise.all([
      query(`SELECT (SELECT count(*) FROM companies)::int AS companies,
                    (SELECT count(*) FROM contacts)::int  AS contacts,
                    (SELECT count(*) FROM deals)::int     AS deals,
                    (SELECT count(*) FROM leads)::int     AS leads`),
      query(`SELECT (SELECT count(*) FROM contacts WHERE company_id IS NULL)::int AS contacts_without_company,
                    (SELECT count(*) FROM companies c
                      WHERE NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.company_id = c.id))::int AS companies_without_contacts,
                    (SELECT count(*) FROM companies WHERE coalesce(city, '') = '')::int AS companies_without_city,
                    (SELECT count(*) FROM leads WHERE company_id IS NULL)::int AS leads_without_company,
                    (SELECT count(*) FROM deals d
                      WHERE d.stage_id IS NOT NULL AND d.stage_id <> ''
                        AND NOT EXISTS (SELECT 1 FROM crm_status s
                                         WHERE s.status_id = d.stage_id
                                           AND (s.semantics IN ('S', 'F') OR s.status_id IN ('WON', 'LOSE')))
                    )::int AS open_deals`),
      query(
        `SELECT raw->>$1 AS key, count(*)::int AS value
           FROM companies
          WHERE coalesce(raw->>$1, '') <> ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        [segmentField],
      ),
      query(
        `SELECT source_id AS key, count(*)::int AS value
           FROM companies
          WHERE source_id IS NOT NULL AND source_id <> ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      ),
      query(
        `SELECT coalesce(city, 'Без города') AS key, count(*)::int AS value
           FROM companies
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      ),
      query(
        `SELECT stage_id AS key, count(*)::int AS value
           FROM deals
          WHERE stage_id IS NOT NULL AND stage_id <> ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      ),
      query(
        `SELECT status_id AS key, count(*)::int AS value
           FROM leads
          WHERE status_id IS NOT NULL AND status_id <> ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      ),
      query(
        `SELECT to_char(date_trunc('month', date_create), 'YYYY-MM') AS key,
                count(*)::int AS value
           FROM companies
          WHERE date_create > now() - interval '12 months'
          GROUP BY 1 ORDER BY 1`,
      ),
    ]);

    res.json({
      totals: totals.rows[0],
      quality: quality.rows[0],
      segmentField,
      segments: pairs(segments.rows, (key) => decodeEnum(meta, 'company', segmentField, key)),
      sources: pairs(sources.rows, (key) => decodeStatus(meta, key)),
      cities: pairs(cities.rows, (key) => key),
      stages: pairs(stages.rows, (key) => decodeStage(meta, key)),
      leadStages: pairs(leadStages.rows, (key) => decodeStatus(meta, key)),
      timeline: timeline.rows.map((row) => ({ name: row.key, value: Number(row.value) })),
    });
  } catch (err) {
    next(err);
  }
});

/** Состояние ETL: что выгружено, докуда дошли, были ли ошибки. */
statsRouter.get('/stats/sync', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT entity, total, last_id, fetched, status, last_error, last_run
         FROM sync_state ORDER BY entity`,
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});
