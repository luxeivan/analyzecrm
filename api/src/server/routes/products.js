import { Router } from 'express';
import { query } from '../../db.js';
import { paging } from '../query.js';
import { decodeEnum, decodeStatus, getMeta } from '../crm.js';

export const productsRouter = Router();

/**
 * Отчёты по товарам.
 *
 * Товары и состав сделок лежат в products / product_sections / deal_product_rows.
 * Сумма строки = price * quantity (в Битриксе price — цена за единицу на момент продажи).
 * «Продано» по умолчанию считается только по успешным сделкам (стадии с семантикой S),
 * параметр stage=all снимает это ограничение.
 */
const WON = `EXISTS (SELECT 1 FROM crm_status cs WHERE cs.status_id = d.stage_id AND cs.semantics = 'S')`;

const SORTS = {
  id: 'p.id',
  name: 'p.name',
  price: 'p.price',
  revenue: 'revenue',
  qty: 'qty',
  deals: 'deals',
  companies: 'companies',
};

const GROUP_SQL = {
  week: "date_trunc('week', d.date_create)",
  month: "date_trunc('month', d.date_create)",
  quarter: "date_trunc('quarter', d.date_create)",
  year: "date_trunc('year', d.date_create)",
};

/** Период из query: from/to (YYYY-MM-DD), условия добавляются в params. */
const periodFilter = (params, req) => {
  const parts = [];
  const from = String(req.query.from ?? '').trim();
  const to = String(req.query.to ?? '').trim();
  if (from) parts.push(`AND d.date_create >= $${params.push(from)}`);
  if (to) parts.push(`AND d.date_create < ($${params.push(to)}::date + interval '1 day')`);
  return { from, to, sql: parts.join(' ') };
};

const onlyWon = (req) => String(req.query.stage ?? 'won') !== 'all';
const groupSql = (req) => GROUP_SQL[String(req.query.group)] || GROUP_SQL.month;

// ---------------------------------------------------------------------------
// Разделы каталога (плоский список; дерево собирает фронтенд)
// ---------------------------------------------------------------------------
productsRouter.get('/product-sections', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.parent_id, s.sort, count(p.id)::int AS products
         FROM product_sections s
         LEFT JOIN products p ON p.section_id = s.id
        GROUP BY s.id, s.name, s.parent_id, s.sort
        ORDER BY s.sort NULLS LAST, s.name`,
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Список товаров с показателями продаж: «что продаётся лучше всего»
// ---------------------------------------------------------------------------
productsRouter.get('/products', async (req, res, next) => {
  try {
    const { limit, page, offset } = paging(req);

    const statsParams = [];
    const period = periodFilter(statsParams, req);
    const wonSql = onlyWon(req) ? `AND ${WON}` : '';

    const params = [];
    const base = statsParams.length;
    const push = (value) => {
      params.push(value);
      return base + params.length;
    };
    const where = [];

    const search = String(req.query.q ?? '').trim();
    if (search) {
      const like = push(`%${search}%`);
      where.push(`(p.name ILIKE $${like} OR p.search_text ILIKE $${like})`);
    }

    const section = Number(req.query.section);
    if (Number.isFinite(section) && section > 0) {
      const idx = push(section);
      // раздел + все вложенные разделы
      where.push(`p.section_id IN (
        WITH RECURSIVE sub AS (
          SELECT id FROM product_sections WHERE id = $${idx}
          UNION ALL
          SELECT s.id FROM product_sections s JOIN sub ON s.parent_id = sub.id
        ) SELECT id FROM sub)`);
    }

    if (String(req.query.active ?? '') === '1') where.push('p.active');

    const statsSql = `SELECT r.product_id,
                             sum(r.quantity)::float8 AS qty,
                             sum(r.price * r.quantity)::float8 AS revenue,
                             count(DISTINCT r.deal_id)::int AS deals,
                             count(DISTINCT d.company_id)::int AS companies
                        FROM deal_product_rows r
                        JOIN deals d ON d.id = r.deal_id
                       WHERE r.product_id IS NOT NULL ${wonSql} ${period.sql}
                       GROUP BY r.product_id`;

    const sortKey = String(req.query.sort ?? 'revenue');
    const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderSql = `ORDER BY ${SORTS[sortKey] || SORTS.revenue} ${dir} NULLS LAST, p.id`;

    if (String(req.query.sold ?? '') === '1') where.push('s.product_id IS NOT NULL');

    const limitIdx = push(limit);
    const offsetIdx = push(offset);

    const { rows } = await query(
      `WITH s AS (${statsSql})
       SELECT p.id, p.name, p.section_id, p.price::float8 AS price, p.currency_id, p.measure, p.active,
              COALESCE(s.qty, 0) AS qty,
              COALESCE(s.revenue, 0) AS revenue,
              COALESCE(s.deals, 0) AS deals,
              COALESCE(s.companies, 0) AS companies,
              count(*) OVER() AS total
         FROM products p
         LEFT JOIN s ON s.product_id = p.id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...statsParams, ...params],
    );

    const total = Number(rows[0]?.total ?? 0);
    res.json({
      items: rows.map(({ total: _total, ...row }) => row),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Сводка по ассортименту: KPI, топ товаров, топ категорий, динамика
// ---------------------------------------------------------------------------
productsRouter.get('/products/analytics', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const group = groupSql(req);

    const params = [];
    const period = periodFilter(params, req);
    const wonSql = onlyWon(req) ? `AND ${WON}` : '';

    /** FROM ... WHERE для строк товаров; withProducts добавляет join на products. */
    const from = (withProducts = false) => `FROM deal_product_rows r
        JOIN deals d ON d.id = r.deal_id
        ${withProducts ? 'JOIN products p ON p.id = r.product_id' : ''}
       WHERE r.product_id IS NOT NULL ${wonSql} ${period.sql}`;

    const [totals, timeline] = await Promise.all([
      query(
        `SELECT COALESCE(sum(r.price * r.quantity), 0)::float8 AS revenue,
                COALESCE(sum(r.quantity), 0)::float8 AS qty,
                count(DISTINCT r.deal_id)::int AS deals,
                count(DISTINCT d.company_id)::int AS companies,
                count(DISTINCT r.product_id)::int AS products
           ${from()}`,
        [...params],
      ),
      query(
        `SELECT ${group}::date AS period,
                sum(r.price * r.quantity)::float8 AS revenue,
                sum(r.quantity)::float8 AS qty,
                count(DISTINCT r.deal_id)::int AS deals
           ${from()}
          GROUP BY 1 ORDER BY 1`,
        [...params],
      ),
    ]);

    const topProducts = await query(
      `SELECT r.product_id AS id,
              COALESCE(max(r.product_name), 'Товар #' || r.product_id) AS name,
              p.section_id,
              sum(r.quantity)::float8 AS qty,
              sum(r.price * r.quantity)::float8 AS revenue,
              count(DISTINCT r.deal_id)::int AS deals,
              count(DISTINCT d.company_id)::int AS companies
         ${from(true)}
        GROUP BY r.product_id, p.section_id
        ORDER BY revenue DESC NULLS LAST
        LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    const sectionStats = await query(
      `SELECT p.section_id,
              sum(r.price * r.quantity)::float8 AS revenue,
              sum(r.quantity)::float8 AS qty,
              count(DISTINCT r.deal_id)::int AS deals
         ${from(true)}
           AND p.section_id IS NOT NULL
        GROUP BY p.section_id`,
      [...params],
    );

    const { rows: sections } = await query('SELECT id, name, parent_id FROM product_sections');
    const byId = new Map(sections.map((row) => [Number(row.id), row]));

    // Свёртка по предкам: категория = она сама + все подкатегории
    const rollup = new Map();
    for (const row of sectionStats.rows) {
      let current = byId.get(Number(row.section_id));
      const seen = new Set();
      while (current && !seen.has(Number(current.id))) {
        seen.add(Number(current.id));
        const acc = rollup.get(Number(current.id)) || {
          id: Number(current.id),
          name: current.name,
          revenue: 0,
          qty: 0,
          deals: 0,
        };
        acc.revenue += Number(row.revenue) || 0;
        acc.qty += Number(row.qty) || 0;
        acc.deals += Number(row.deals) || 0;
        rollup.set(Number(current.id), acc);
        current = current.parent_id ? byId.get(Number(current.parent_id)) : null;
      }
    }

    res.json({
      period: { from: period.from || null, to: period.to || null, group: String(req.query.group ?? 'month') },
      stage: onlyWon(req) ? 'won' : 'all',
      totals: totals.rows[0],
      topProducts: topProducts.rows,
      topSections: [...rollup.values()]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit)
        .map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) })),
      timeline: timeline.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Отчёт по товару: динамика по времени + компании, которые его покупали
// ---------------------------------------------------------------------------
const sectionPath = async (sectionId) => {
  if (!sectionId) return [];
  const { rows } = await query(
    `WITH RECURSIVE up AS (
       SELECT id, name, parent_id, 0 AS lvl FROM product_sections WHERE id = $1
       UNION ALL
       SELECT s.id, s.name, s.parent_id, up.lvl + 1
         FROM product_sections s JOIN up ON s.id = up.parent_id
     )
     SELECT id, name FROM up ORDER BY lvl DESC`,
    [sectionId],
  );
  return rows;
};

const reportBase = (params, req, { productId = null, extraJoin = '', extraWhere = '' } = {}) => {
  const period = periodFilter(params, req);
  const wonSql = onlyWon(req) ? `AND ${WON}` : '';
  const idSql = productId === null ? '' : `r.product_id = $${params.push(productId)} AND `;
  const sql = `FROM deal_product_rows r
                 JOIN deals d ON d.id = r.deal_id
                 ${extraJoin}
                WHERE ${idSql}r.product_id IS NOT NULL ${wonSql} ${period.sql} ${extraWhere}`;
  return { sql, period };
};

productsRouter.get('/products/:id/report', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const { rows: productRows } = await query('SELECT * FROM products WHERE id = $1', [id]);
    const product = productRows[0];
    if (!product) return res.status(404).json({ error: 'Товар не найден' });

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const group = groupSql(req);

    const params = [];
    const companiesParams = [];
    const dealsParams = [];
    const { sql: base, period } = reportBase(params, req, { productId: id });

    const [totals, timeline, companies, deals] = await Promise.all([
      query(
        `SELECT COALESCE(sum(r.price * r.quantity), 0)::float8 AS revenue,
                COALESCE(sum(r.quantity), 0)::float8 AS qty,
                COALESCE(sum(r.discount_sum), 0)::float8 AS discount,
                count(DISTINCT r.deal_id)::int AS deals,
                count(DISTINCT d.company_id)::int AS companies,
                min(d.date_create) AS first_at,
                max(d.date_create) AS last_at
           ${base}`,
        [...params],
      ),
      query(
        `SELECT ${group}::date AS period,
                sum(r.price * r.quantity)::float8 AS revenue,
                sum(r.quantity)::float8 AS qty,
                count(DISTINCT r.deal_id)::int AS deals,
                count(DISTINCT d.company_id)::int AS companies
           ${base}
          GROUP BY 1 ORDER BY 1`,
        [...params],
      ),
      query(
        `SELECT d.company_id AS id,
                max(co.title) AS title,
                max(co.city) AS city,
                max(co.industry_id) AS industry_id,
                max(co.source_id) AS source_id,
                sum(r.price * r.quantity)::float8 AS revenue,
                sum(r.quantity)::float8 AS qty,
                count(DISTINCT r.deal_id)::int AS deals,
                count(DISTINCT r.deal_id) FILTER (WHERE ${WON})::int AS won_deals,
                min(d.date_create) AS first_at,
                max(d.date_create) AS last_at,
                max((SELECT count(*) FROM contacts c2 WHERE c2.company_id = d.company_id))::int AS contacts
           ${reportBase(companiesParams, req, {
             productId: id,
             extraJoin: 'LEFT JOIN companies co ON co.id = d.company_id',
           }).sql}
             AND d.company_id IS NOT NULL
          GROUP BY d.company_id
          ORDER BY revenue DESC NULLS LAST
          LIMIT $${companiesParams.length + 1}`,
        [...companiesParams, limit],
      ),
      query(
        `SELECT r.deal_id, d.title AS deal_title, d.stage_id, d.company_id, co.title AS company_title,
                d.opportunity::float8 AS opportunity, r.quantity::float8 AS quantity,
                (r.price * r.quantity)::float8 AS revenue, d.date_create
           ${reportBase(dealsParams, req, { productId: id, extraJoin: 'LEFT JOIN companies co ON co.id = d.company_id' }).sql}
          ORDER BY d.date_create DESC
          LIMIT 20`,
        [...dealsParams],
      ),
    ]);

    res.json({
      product: {
        id: product.id,
        name: product.name,
        section_id: product.section_id,
        section_path: await sectionPath(product.section_id),
        price: product.price === null ? null : Number(product.price),
        currency_id: product.currency_id,
        measure: decodeEnum(meta, 'product', 'MEASURE', product.measure),
        active: product.active,
        raw: product.raw,
      },
      period: { from: period.from || null, to: period.to || null, group: String(req.query.group ?? 'month') },
      stage: onlyWon(req) ? 'won' : 'all',
      totals: totals.rows[0],
      timeline: timeline.rows,
      companies: companies.rows.map((row) => ({
        ...row,
        industry: decodeEnum(meta, 'company', 'INDUSTRY', row.industry_id),
        source: decodeStatus(meta, row.source_id),
      })),
      deals: deals.rows.map((row) => ({ ...row, stage: decodeStatus(meta, row.stage_id) })),
    });
  } catch (err) {
    next(err);
  }
});

// CSV-выгрузка компаний из отчёта по товару (для Excel)
productsRouter.get('/products/:id/report.csv', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const params = [];
    const { sql: base } = reportBase(params, req, { productId: id, extraJoin: 'LEFT JOIN companies co ON co.id = d.company_id' });

    const { rows } = await query(
      `SELECT d.company_id, max(co.title) AS title, max(co.city) AS city,
              sum(r.price * r.quantity)::float8 AS revenue,
              sum(r.quantity)::float8 AS qty,
              count(DISTINCT r.deal_id)::int AS deals,
              min(d.date_create)::date AS first_at,
              max(d.date_create)::date AS last_at
         ${base}
           AND d.company_id IS NOT NULL
        GROUP BY d.company_id
        ORDER BY revenue DESC NULLS LAST`,
      [...params],
    );

    const csv = [
      ['ID компании', 'Компания', 'Город', 'Выручка', 'Количество', 'Сделок', 'Первая покупка', 'Последняя покупка'],
      ...rows.map((row) => [
        row.company_id,
        row.title ?? '',
        row.city ?? '',
        Number(row.revenue ?? 0).toFixed(2),
        Number(row.qty ?? 0),
        row.deals,
        row.first_at ?? '',
        row.last_at ?? '',
      ]),
    ]
      .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';'))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="product-${id}-companies.csv"`);
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    next(err);
  }
});

productsRouter.get('/products/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const { rows } = await query('SELECT * FROM products WHERE id = $1', [id]);
    const product = rows[0];
    if (!product) return res.status(404).json({ error: 'Товар не найден' });

    const stats = await query(
      `SELECT count(DISTINCT r.deal_id)::int AS deals,
              count(DISTINCT d.company_id)::int AS companies,
              COALESCE(sum(r.price * r.quantity), 0)::float8 AS revenue
         FROM deal_product_rows r JOIN deals d ON d.id = r.deal_id
        WHERE r.product_id = $1`,
      [id],
    );

    res.json({
      id: product.id,
      name: product.name,
      section_id: product.section_id,
      section_path: await sectionPath(product.section_id),
      price: product.price === null ? null : Number(product.price),
      currency_id: product.currency_id,
      measure: product.measure,
      active: product.active,
      code: product.code,
      description: product.description,
      date_create: product.date_create,
      date_modify: product.date_modify,
      stats: stats.rows[0],
      raw: product.raw,
    });
  } catch (err) {
    next(err);
  }
});
