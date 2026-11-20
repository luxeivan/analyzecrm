import { spawn } from 'node:child_process';
import { Router } from 'express';
import { query } from '../../db.js';
import { getServiceState } from '../../etl/load.js';
import { getMeta, decodeStatus } from '../crm.js';
import { requireAdmin } from '../../auth.js';

export const duplicatesRouter = Router();

const ENTITIES = {
  company: 'companies',
  contact: 'contacts',
  lead: 'leads',
};

const LABELS = { company: 'Компании', contact: 'Контакты', lead: 'Лиды' };

const clampLimit = (value, fallback = 25) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(200, Math.round(n)) : fallback;
};

const listValues = (value) => {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => (typeof item === 'string' ? item : item?.VALUE ?? item?.value ?? ''))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join(', ');
};

async function stateSummary() {
  const raw = await getServiceState('duplicates');
  return raw ? JSON.parse(raw) : null;
}

/** GET /api/duplicates/summary — сколько пар по каждой сущности и покрытие векторами. */
duplicatesRouter.get('/duplicates/summary', async (_req, res, next) => {
  try {
    const state = await stateSummary();
    const [pairs, coverage] = await Promise.all([
      query(`SELECT entity, count(*)::int AS count FROM duplicate_pairs GROUP BY 1`),
      query(`SELECT 'company' AS entity, count(*)::int AS total, count(embedding)::int AS embedded FROM companies
             UNION ALL SELECT 'contact', count(*), count(embedding) FROM contacts
             UNION ALL SELECT 'lead', count(*), count(embedding) FROM leads`),
    ]);

    const pairsByEntity = Object.fromEntries(pairs.rows.map((row) => [row.entity, row.count]));
    const coverageByEntity = Object.fromEntries(coverage.rows.map((row) => [row.entity, row]));

    res.json({
      threshold: state?.threshold ?? 0.9,
      computedAt: state?.finishedAt ?? state?.updatedAt ?? null,
      running: Boolean(state && !state.finishedAt),
      byEntity: Object.keys(ENTITIES).map((entity) => ({
        entity,
        label: LABELS[entity],
        pairs: pairsByEntity[entity] ?? 0,
        total: coverageByEntity[entity]?.total ?? 0,
        embedded: coverageByEntity[entity]?.embedded ?? 0,
        computedAt: state?.byEntity?.[entity]?.computedAt ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/duplicates/run — пересчитать пары в фоне (спавнит etl/duplicates.js). */
duplicatesRouter.post('/duplicates/run', requireAdmin, async (req, res, next) => {
  try {
    const state = await stateSummary();
    if (state && !state.finishedAt && state.updatedAt) {
      const age = Date.now() - new Date(state.updatedAt).getTime();
      if (age < 3 * 60_000) return res.status(409).json({ error: 'Расчёт дублей уже идёт' });
    }

    const threshold = Math.min(0.999, Math.max(0.5, Number(req.body?.threshold) || 0.9));
    const child = spawn(process.execPath, ['src/etl/duplicates.js', `--threshold=${threshold}`], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();

    res.status(202).json({ started: true, threshold });
  } catch (err) {
    next(err);
  }
});

/** GET /api/duplicates/:entity?threshold=&page=&limit= — пары с названиями для сравнения. */
duplicatesRouter.get('/duplicates/:entity', async (req, res, next) => {
  try {
    const entity = String(req.params.entity);
    if (!ENTITIES[entity]) return res.status(400).json({ error: 'Неизвестная сущность' });

    const threshold = Math.min(0.999, Math.max(0.5, Number(req.query.threshold) || 0.9));
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = clampLimit(req.query.limit);
    const offset = (page - 1) * limit;

    const meta = await getMeta();
    const secondary =
      entity === 'company'
        ? `a.city AS a_extra, b.city AS b_extra`
        : entity === 'contact' || entity === 'lead'
          ? `ca.title AS a_extra, cb.title AS b_extra`
          : `NULL AS a_extra, NULL AS b_extra`;
    const joins =
      entity === 'company'
        ? ''
        : `LEFT JOIN companies ca ON ca.id = a.company_id
           LEFT JOIN companies cb ON cb.id = b.company_id`;
    const statusCols =
      entity === 'lead' ? `a.status_id AS a_status, b.status_id AS b_status` : `NULL AS a_status, NULL AS b_status`;

    const [items, count] = await Promise.all([
      query(
        `SELECT p.a_id, p.b_id, p.score,
                a.title AS a_title, b.title AS b_title,
                ${secondary},
                ${statusCols}
           FROM duplicate_pairs p
           JOIN ${ENTITIES[entity]} a ON a.id = p.a_id
           JOIN ${ENTITIES[entity]} b ON b.id = p.b_id
           ${joins}
          WHERE p.entity = $1 AND p.score >= $2
          ORDER BY p.score DESC, p.a_id
          LIMIT $3 OFFSET $4`,
        [entity, threshold, limit, offset],
      ),
      query(`SELECT count(*)::int AS count FROM duplicate_pairs WHERE entity = $1 AND score >= $2`, [
        entity,
        threshold,
      ]),
    ]);

    const decodeLeadStatus = (id) => (id ? decodeStatus(meta, id) ?? id : null);

    res.json({
      entity,
      threshold,
      page,
      limit,
      total: count.rows[0].count,
      items: items.rows.map((row) => ({
        a: { id: row.a_id, title: row.a_title, extra: row.a_extra, status: row.a_status },
        b: { id: row.b_id, title: row.b_title, extra: row.b_extra, status: row.b_status },
        score: row.score,
        ...(entity === 'lead'
          ? { aStatusName: decodeLeadStatus(row.a_status), bStatusName: decodeLeadStatus(row.b_status) }
          : {}),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/duplicates/:entity/pair?a=&b= — карточки обеих записей для сравнения. */
duplicatesRouter.get('/duplicates/:entity/pair', async (req, res, next) => {
  try {
    const entity = String(req.params.entity);
    if (!ENTITIES[entity]) return res.status(400).json({ error: 'Неизвестная сущность' });

    const ids = [Number(req.query.a), Number(req.query.b)];
    if (ids.some((id) => !Number.isFinite(id))) return res.status(400).json({ error: 'Нужны параметры a и b' });

    const meta = await getMeta();

    let rows;
    if (entity === 'company') {
      ({ rows } = await query(
        `SELECT id, title, city, region, phones, emails, date_create, date_modify,
                raw->>'ADDRESS_CITY' AS addr_city,
                raw->>'ADDRESS' AS address,
                raw->>'INN' AS inn
           FROM companies WHERE id = ANY($1::bigint[])`,
        [ids],
      ));
    } else if (entity === 'contact') {
      ({ rows } = await query(
        `SELECT c.id, c.title, c.name, c.last_name, c.second_name, c.company_id,
                co.title AS company_title, c.phones, c.emails, c.date_create, c.date_modify,
                c.raw->>'POST' AS post
           FROM contacts c
           LEFT JOIN companies co ON co.id = c.company_id
          WHERE c.id = ANY($1::bigint[])`,
        [ids],
      ));
    } else {
      ({ rows } = await query(
        `SELECT l.id, l.title, l.name, l.last_name, l.second_name, l.company_id,
                co.title AS company_title, l.status_id, l.source_id, l.date_create, l.date_modify,
                l.raw->>'PHONE' AS phone_raw
           FROM leads l
           LEFT JOIN companies co ON co.id = l.company_id
          WHERE l.id = ANY($1::bigint[])`,
        [ids],
      ));
    }

    const present = rows.map((row) => {
      const phones = listValues(row.phones) || row.phone_raw || '';
      return {
        id: row.id,
        title: row.title,
        fields: Object.entries(row)
          .filter(([key]) => !['id', 'title', 'phones', 'emails', 'phone_raw'].includes(key))
          .map(([key, value]) => ({
            key,
            label: key,
            value: typeof value === 'string' ? value : value == null ? '' : String(value),
          }))
          .concat([
            phones ? { key: 'phones', label: 'телефоны', value: phones } : null,
            listValues(row.emails) ? { key: 'emails', label: 'email', value: listValues(row.emails) } : null,
          ])
          .filter(Boolean),
        ...(entity === 'lead' ? { statusName: decodeStatus(meta, row.status_id) ?? row.status_id } : {}),
      };
    });

    const byId = Object.fromEntries(present.map((row) => [row.id, row]));
    res.json({ a: byId[ids[0]] ?? null, b: byId[ids[1]] ?? null });
  } catch (err) {
    next(err);
  }
});

/** Union-Find: объединяем пары в группы (транзитивно), чтобы ловить задублирование 3+ карточек. */
function buildGroups(pairs) {
  const parent = new Map();
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const ensure = (x) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a, b) => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const pair of pairs) union(Number(pair.a_id), Number(pair.b_id));

  const groups = new Map();
  for (const pair of pairs) {
    const root = find(Number(pair.a_id));
    if (!groups.has(root)) groups.set(root, { ids: new Set(), minScore: 1, maxScore: 0 });
    const group = groups.get(root);
    group.ids.add(Number(pair.a_id));
    group.ids.add(Number(pair.b_id));
    group.minScore = Math.min(group.minScore, Number(pair.score));
    group.maxScore = Math.max(group.maxScore, Number(pair.score));
  }

  return [...groups.values()]
    .map((group) => ({ ids: [...group.ids].sort((a, b) => a - b), minScore: group.minScore, maxScore: group.maxScore }))
    .sort((a, b) => b.ids.length - a.ids.length || b.minScore - a.minScore);
}

const pairsForGroups = async (entity, threshold) => {
  const { rows } = await query(
    `SELECT a_id, b_id, score FROM duplicate_pairs WHERE entity = $1 AND score >= $2`,
    [entity, threshold],
  );
  return rows;
};

const dealColumn = (entity) => (entity === 'company' ? 'company_id' : entity === 'contact' ? 'contact_id' : null);

/** Сводка сделок по записям: сколько, на какую сумму, сколько выиграно. */
async function dealsByRef(entity, ids) {
  const column = dealColumn(entity);
  if (!column || !ids.length) return {};
  const { rows } = await query(
    `SELECT ${column} AS ref,
            count(*)::int AS count,
            coalesce(sum(opportunity), 0)::float8 AS sum,
            coalesce(sum(opportunity) FILTER (WHERE stage_id = 'WON'), 0)::float8 AS won_sum
       FROM deals
      WHERE ${column} = ANY($1::bigint[])
      GROUP BY 1`,
    [ids],
  );
  return Object.fromEntries(rows.map((row) => [Number(row.ref), row]));
}

/** Полные карточки записей (поля для сравнения) + сделки. */
async function fullRecords(entity, ids, meta) {
  let rows;
  if (entity === 'company') {
    ({ rows } = await query(
      `SELECT id, title, city, region, phones, emails, date_create, date_modify,
              raw->>'ADDRESS' AS address, raw->>'INN' AS inn
         FROM companies WHERE id = ANY($1::bigint[])`,
      [ids],
    ));
  } else if (entity === 'contact') {
    ({ rows } = await query(
      `SELECT c.id, c.title, c.name, c.last_name, c.second_name, c.company_id,
              co.title AS company_title, c.phones, c.emails, c.date_create, c.date_modify,
              c.raw->>'POST' AS post
         FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
        WHERE c.id = ANY($1::bigint[])`,
      [ids],
    ));
  } else {
    ({ rows } = await query(
      `SELECT l.id, l.title, l.name, l.last_name, l.second_name, l.company_id,
              co.title AS company_title, l.status_id, l.source_id, l.date_create, l.date_modify,
              l.raw->>'PHONE' AS phone_raw
         FROM leads l
         LEFT JOIN companies co ON co.id = l.company_id
        WHERE l.id = ANY($1::bigint[])`,
      [ids],
    ));
  }

  const [dealsSummary, dealsItems] = await Promise.all([
    dealsByRef(entity, ids),
    (async () => {
      const column = dealColumn(entity);
      if (!column) return { rows: [] };
      return query(
        `SELECT * FROM (
           SELECT ${column} AS ref, id, title, opportunity::float8 AS opportunity, stage_id, date_create,
                  row_number() OVER (PARTITION BY ${column} ORDER BY date_create DESC NULLS LAST) AS rn
             FROM deals
            WHERE ${column} = ANY($1::bigint[])
         ) t WHERE rn <= 5 ORDER BY ref, date_create DESC NULLS LAST`,
        [ids],
      );
    })(),
  ]);

  const itemsByRef = new Map();
  for (const row of dealsItems.rows) {
    const list = itemsByRef.get(Number(row.ref)) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      opportunity: row.opportunity,
      stageName: decodeStatus(meta, row.stage_id) ?? row.stage_id,
      date_create: row.date_create,
    });
    itemsByRef.set(Number(row.ref), list);
  }

  return rows.map((row) => {
    const phones = listValues(row.phones) || row.phone_raw || '';
    const fields = Object.entries(row)
      .filter(([key]) => !['id', 'title', 'phones', 'emails', 'phone_raw', 'status_id', 'source_id'].includes(key))
      .map(([key, value]) => ({
        key,
        label: key,
        value: typeof value === 'string' ? value : value == null ? '' : String(value),
      }))
      .concat([
        phones ? { key: 'phones', label: 'phones', value: phones } : null,
        listValues(row.emails) ? { key: 'emails', label: 'emails', value: listValues(row.emails) } : null,
      ])
      .filter(Boolean);

    return {
      id: row.id,
      title: row.title,
      fields,
      statusName: row.status_id ? decodeStatus(meta, row.status_id) ?? row.status_id : null,
      deals: {
        ...(dealsSummary[Number(row.id)] ?? { count: 0, sum: 0, won_sum: 0 }),
        items: itemsByRef.get(Number(row.id)) ?? [],
      },
    };
  });
}

/** GET /api/duplicates/:entity/groups — группы дублей (2+ карточек), сгруппированные транзитивно. */
duplicatesRouter.get('/duplicates/:entity/groups', async (req, res, next) => {
  try {
    const entity = String(req.params.entity);
    if (!ENTITIES[entity]) return res.status(400).json({ error: 'Неизвестная сущность' });

    const threshold = Math.min(0.999, Math.max(0.5, Number(req.query.threshold) || 0.9));
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = clampLimit(req.query.limit, 20);

    const pairs = await pairsForGroups(entity, threshold);
    const groups = buildGroups(pairs);
    const slice = groups.slice((page - 1) * limit, page * limit);
    const ids = [...new Set(slice.flatMap((group) => group.ids))];

    const titles = await (async () => {
      const column = entity === 'company' ? 'city' : null;
      const extraSelect = column ? `, ${column} AS extra` : '';
      return query(
        `SELECT id, title${extraSelect} FROM ${ENTITIES[entity]} WHERE id = ANY($1::bigint[])`,
        [ids],
      );
    })();
    const titlesById = new Map(titles.rows.map((row) => [Number(row.id), row]));

    res.json({
      entity,
      threshold,
      page,
      limit,
      total: groups.length,
      recordsInGroups: groups.reduce((sum, group) => sum + group.ids.length, 0),
      exactGroups: groups.filter((group) => group.minScore >= 0.999).length,
      items: slice.map((group) => ({
        key: group.ids[0],
        size: group.ids.length,
        minScore: group.minScore,
        maxScore: group.maxScore,
        records: group.ids.map((id) => ({
          id,
          title: titlesById.get(id)?.title ?? null,
          extra: titlesById.get(id)?.extra ?? null,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/duplicates/:entity/group?ids=1,2,3 — все карточки группы с полями и сделками. */
duplicatesRouter.get('/duplicates/:entity/group', async (req, res, next) => {
  try {
    const entity = String(req.params.entity);
    if (!ENTITIES[entity]) return res.status(400).json({ error: 'Неизвестная сущность' });

    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));

    if (!ids.length) return res.status(400).json({ error: 'Нужен параметр ids' });

    const meta = await getMeta();
    res.json({ entity, records: await fullRecords(entity, ids, meta) });
  } catch (err) {
    next(err);
  }
});
