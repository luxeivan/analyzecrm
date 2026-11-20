import { Router } from 'express';
import { query } from '../../db.js';
import { applyOrder, buildFilters, paging } from '../query.js';
import { decodeEnum, decodeStatus, describeEntity, getMeta } from '../crm.js';

export const entitiesRouter = Router();

const SORT = {
  companies: {
    id: 'id',
    title: 'title',
    city: 'city',
    industry: 'industry_id',
    source: 'source_id',
    date_create: 'date_create',
    date_modify: 'date_modify',
  },
  contacts: {
    id: 'c.id',
    title: 'c.title',
    company: 'co.title',
    source: 'c.source_id',
    date_create: 'c.date_create',
    date_modify: 'c.date_modify',
  },
  leads: {
    id: 'l.id',
    title: 'l.title',
    company: 'co.title',
    contact: 'ct.title',
    status: 'l.status_id',
    source: 'l.source_id',
    opportunity: 'l.opportunity',
    date_create: 'l.date_create',
    date_modify: 'l.date_modify',
  },
  deals: {
    id: 'd.id',
    title: 'd.title',
    company: 'co.title',
    stage: 'd.stage_id',
    opportunity: 'd.opportunity',
    date_create: 'd.date_create',
    date_modify: 'd.date_modify',
  },
};

const decorateCompany = (meta, row) => {
  const { total, ...rest } = row;
  return {
    ...rest,
    industry: decodeEnum(meta, 'company', 'INDUSTRY', row.industry_id),
    source: decodeStatus(meta, row.source_id),
  };
};

const withPage = (items, rows, page, limit) => {
  const total = rows[0]?.total ?? 0;
  return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
};

// ---------------------------------------------------------------------------
// Компании
// ---------------------------------------------------------------------------
entitiesRouter.get('/companies', async (req, res, next) => {
  try {
    const meta = await getMeta();
    const { limit, page, offset } = paging(req);
    const { whereSql, params } = buildFilters(req, {
      search: ['title'],
      exact: {
        industry: 'industry_id',
        source: 'source_id',
        assigned_by_id: 'assigned_by_id',
        id: 'id',
      },
      like: { city: 'city', region: 'region' },
    });

    const orderSql = applyOrder(params, {
      sort: req.query.sort,
      dir: req.query.dir,
      columns: SORT.companies,
      fallback: 'date_modify',
    });

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await query(
      `SELECT id, title, industry_id, source_id, assigned_by_id, city, region, phones, emails,
              date_create, date_modify, count(*) OVER() AS total
         FROM companies ${whereSql} ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json(withPage(rows.map((row) => decorateCompany(meta, row)), rows, page, limit));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get('/companies/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const { rows } = await query('SELECT * FROM companies WHERE id = $1', [id]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Компания не найдена' });

    const [contacts, deals, dealTotals] = await Promise.all([
      query(
        `SELECT id, title, name, last_name, second_name, phones, emails, raw->>'POST' AS position,
                source_id, date_create, date_modify
           FROM contacts WHERE company_id = $1
          ORDER BY date_modify DESC NULLS LAST LIMIT 500`,
        [id],
      ),
      query(
        `SELECT id, title, stage_id, category_id, opportunity::float8 AS opportunity, currency_id, date_create, date_modify
           FROM deals WHERE company_id = $1
          ORDER BY date_modify DESC NULLS LAST LIMIT 500`,
        [id],
      ),
      query(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE stage_id LIKE 'WON%')::int AS won,
                count(*) FILTER (WHERE stage_id NOT LIKE 'WON%' AND stage_id NOT LIKE 'LOSE%')::int AS open,
                COALESCE(sum(opportunity), 0)::float8 AS sum,
                COALESCE(sum(CASE WHEN stage_id NOT LIKE 'WON%' AND stage_id NOT LIKE 'LOSE%' THEN opportunity END), 0)::float8 AS open_sum
           FROM deals WHERE company_id = $1`,
        [id],
      ),
    ]);

    res.json({
      id: company.id,
      title: company.title,
      industry: decodeEnum(meta, 'company', 'INDUSTRY', company.industry_id),
      source: decodeStatus(meta, company.source_id),
      city: company.city,
      region: company.region,
      phones: company.phones,
      emails: company.emails,
      date_create: company.date_create,
      date_modify: company.date_modify,
      synced_at: company.synced_at,
      fields: describeEntity(meta, 'company', company.raw),
      contacts: contacts.rows.map((row) => ({
        ...row,
        source: decodeStatus(meta, row.source_id),
      })),
      deals_total: dealTotals.rows[0] ?? { count: 0, won: 0, open: 0, sum: 0, open_sum: 0 },
      deals: deals.rows.map((row) => ({
        ...row,
        stage: decodeStatus(meta, row.stage_id),
      })),
      raw: company.raw,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Контакты
// ---------------------------------------------------------------------------
entitiesRouter.get('/contacts', async (req, res, next) => {
  try {
    const meta = await getMeta();
    const { limit, page, offset } = paging(req);

    const { whereSql: baseWhereSql, params } = buildFilters(req, {
      search: ['c.title', "c.raw->>'POST'"],
      exact: {
        company_id: 'c.company_id',
        source: 'c.source_id',
        assigned_by_id: 'c.assigned_by_id',
        id: 'c.id',
      },
      like: { city: "c.raw->>'ADDRESS_CITY'" },
    });

    // ?without_company=1 — контакты, не привязанные ни к одной компании
    let whereSql = baseWhereSql;
    if (String(req.query.without_company) === '1') {
      whereSql = whereSql
        ? `${whereSql} AND c.company_id IS NULL`
        : 'WHERE c.company_id IS NULL';
    }

    const orderSql = applyOrder(params, {
      sort: req.query.sort,
      dir: req.query.dir,
      columns: SORT.contacts,
      fallback: 'date_modify',
    });

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await query(
      `SELECT c.id, c.title, c.company_id, co.title AS company_title, c.source_id,
              c.phones, c.emails, c.raw->>'POST' AS position,
              c.date_create, c.date_modify, count(*) OVER() AS total
         FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
         ${whereSql} ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const items = rows.map(({ total, ...row }) => ({
      ...row,
      source: decodeStatus(meta, row.source_id),
    }));

    res.json(withPage(items, rows, page, limit));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get('/contacts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [id]);
    const contact = rows[0];
    if (!contact) return res.status(404).json({ error: 'Контакт не найден' });

    const [company, deals, dealTotals] = await Promise.all([
      contact.company_id
        ? query('SELECT id, title, industry_id, city FROM companies WHERE id = $1', [contact.company_id])
        : { rows: [] },
      query(
        `SELECT id, title, stage_id, opportunity::float8 AS opportunity, currency_id, date_create, date_modify
           FROM deals WHERE contact_id = $1
          ORDER BY date_modify DESC NULLS LAST LIMIT 200`,
        [id],
      ),
      query(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE stage_id LIKE 'WON%')::int AS won,
                count(*) FILTER (WHERE stage_id NOT LIKE 'WON%' AND stage_id NOT LIKE 'LOSE%')::int AS open,
                COALESCE(sum(opportunity), 0)::float8 AS sum,
                COALESCE(sum(CASE WHEN stage_id NOT LIKE 'WON%' AND stage_id NOT LIKE 'LOSE%' THEN opportunity END), 0)::float8 AS open_sum
           FROM deals WHERE contact_id = $1`,
        [id],
      ),
    ]);

    res.json({
      id: contact.id,
      title: contact.title,
      name: contact.name,
      last_name: contact.last_name,
      second_name: contact.second_name,
      company_id: contact.company_id,
      company: company.rows[0] || null,
      source: decodeStatus(meta, contact.source_id),
      phones: contact.phones,
      emails: contact.emails,
      date_create: contact.date_create,
      date_modify: contact.date_modify,
      fields: describeEntity(meta, 'contact', contact.raw),
      deals_total: dealTotals.rows[0] ?? { count: 0, won: 0, open: 0, sum: 0, open_sum: 0 },
      deals: deals.rows.map((row) => ({ ...row, stage: decodeStatus(meta, row.stage_id) })),
      raw: contact.raw,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Лиды
// ---------------------------------------------------------------------------
entitiesRouter.get('/leads', async (req, res, next) => {
  try {
    const meta = await getMeta();
    const { limit, page, offset } = paging(req);
    const { whereSql, params } = buildFilters(req, {
      search: ['l.title', 'l.search_text'],
      exact: {
        company_id: 'l.company_id',
        contact_id: 'l.contact_id',
        status: 'l.status_id',
        source: 'l.source_id',
        assigned_by_id: 'l.assigned_by_id',
        id: 'l.id',
      },
      like: { city: "l.raw->>'ADDRESS_CITY'" },
    });

    const orderSql = applyOrder(params, {
      sort: req.query.sort,
      dir: req.query.dir,
      columns: SORT.leads,
      fallback: 'date_modify',
    });

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await query(
      `SELECT l.id, l.title, l.company_id, co.title AS company_title,
              l.contact_id, ct.title AS contact_title, l.status_id, l.source_id,
              l.opportunity::float8 AS opportunity, l.currency_id,
              l.date_create, l.date_modify, count(*) OVER() AS total
         FROM leads l
         LEFT JOIN companies co ON co.id = l.company_id
         LEFT JOIN contacts ct ON ct.id = l.contact_id
         ${whereSql} ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const items = rows.map(({ total, ...row }) => ({
      ...row,
      status: decodeStatus(meta, row.status_id),
      source: decodeStatus(meta, row.source_id),
    }));

    res.json(withPage(items, rows, page, limit));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get('/leads/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const { rows } = await query('SELECT * FROM leads WHERE id = $1', [id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Лид не найден' });

    const [company, contact] = await Promise.all([
      lead.company_id
        ? query('SELECT id, title, city FROM companies WHERE id = $1', [lead.company_id])
        : { rows: [] },
      lead.contact_id
        ? query('SELECT id, title, phones, emails FROM contacts WHERE id = $1', [lead.contact_id])
        : { rows: [] },
    ]);

    res.json({
      id: lead.id,
      title: lead.title,
      name: lead.name,
      last_name: lead.last_name,
      second_name: lead.second_name,
      company_id: lead.company_id,
      company: company.rows[0] || null,
      contact_id: lead.contact_id,
      contact: contact.rows[0] || null,
      status_id: lead.status_id,
      status: decodeStatus(meta, lead.status_id),
      source_id: lead.source_id,
      source: decodeStatus(meta, lead.source_id),
      opportunity: lead.opportunity === null ? null : Number(lead.opportunity),
      currency_id: lead.currency_id,
      date_create: lead.date_create,
      date_modify: lead.date_modify,
      synced_at: lead.synced_at,
      fields: describeEntity(meta, 'lead', lead.raw),
      raw: lead.raw,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Сделки
// ---------------------------------------------------------------------------
entitiesRouter.get('/deals', async (req, res, next) => {
  try {
    const meta = await getMeta();
    const { limit, page, offset } = paging(req);
    const { whereSql, params } = buildFilters(req, {
      search: ['d.title'],
      exact: {
        company_id: 'd.company_id',
        contact_id: 'd.contact_id',
        stage: 'd.stage_id',
        category: 'd.category_id',
        id: 'd.id',
      },
    });

    const orderSql = applyOrder(params, {
      sort: req.query.sort,
      dir: req.query.dir,
      columns: SORT.deals,
      fallback: 'date_modify',
    });

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await query(
      `SELECT d.id, d.title, d.company_id, d.contact_id, co.title AS company_title,
              ct.title AS contact_title, d.stage_id, d.category_id, d.opportunity::float8 AS opportunity,
              d.currency_id, d.date_create, d.date_modify, count(*) OVER() AS total
         FROM deals d
         LEFT JOIN companies co ON co.id = d.company_id
         LEFT JOIN contacts ct ON ct.id = d.contact_id
         ${whereSql} ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const items = rows.map(({ total, ...row }) => ({ ...row, stage: decodeStatus(meta, row.stage_id) }));
    res.json(withPage(items, rows, page, limit));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get('/deals/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const { rows } = await query('SELECT * FROM deals WHERE id = $1', [id]);
    const deal = rows[0];
    if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });

    res.json({
      id: deal.id,
      title: deal.title,
      company_id: deal.company_id,
      contact_id: deal.contact_id,
      stage_id: deal.stage_id,
      stage: decodeStatus(meta, deal.stage_id),
      category_id: deal.category_id,
      opportunity: deal.opportunity === null ? null : Number(deal.opportunity),
      currency_id: deal.currency_id,
      date_create: deal.date_create,
      date_modify: deal.date_modify,
      fields: describeEntity(meta, 'deal', deal.raw),
      raw: deal.raw,
    });
  } catch (err) {
    next(err);
  }
});
