import { Router } from 'express';
import { query } from '../../db.js';
import { decodeStatus, getMeta } from '../crm.js';

export const graphRouter = Router();

const companyNode = (row) => ({
  id: `company-${row.id}`,
  entity: 'company',
  entityId: row.id,
  label: row.title || `Компания #${row.id}`,
  type: 'company',
});

const contactNode = (row) => ({
  id: `contact-${row.id}`,
  entity: 'contact',
  entityId: row.id,
  label: row.title || `Контакт #${row.id}`,
  type: 'contact',
});

const leadNode = (row, meta) => ({
  id: `lead-${row.id}`,
  entity: 'lead',
  entityId: row.id,
  label: `${row.title || `Лид #${row.id}`}${row.status_id ? ` · ${decodeStatus(meta, row.status_id)}` : ''}`,
  type: 'lead',
  status: decodeStatus(meta, row.status_id),
});

const dealNode = (row, meta) => ({
  id: `deal-${row.id}`,
  entity: 'deal',
  entityId: row.id,
  label: `${row.title || `Сделка #${row.id}`}${
    row.opportunity ? ` · ${Number(row.opportunity).toLocaleString('ru-RU')} ${row.currency_id || ''}` : ''
  }`,
  type: 'deal',
  stage: decodeStatus(meta, row.stage_id),
});

/** Граф одной компании: Компания -> Контакты -> Сделки. */
graphRouter.get('/graph/company/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный ID' });

    const meta = await getMeta();
    const [companyRes, contactsRes, dealsRes, leadsRes] = await Promise.all([
      query('SELECT id, title FROM companies WHERE id = $1', [id]),
      query(
        `SELECT id, title FROM contacts WHERE company_id = $1 ORDER BY date_modify DESC NULLS LAST LIMIT 300`,
        [id],
      ),
      query(
        `SELECT id, title, company_id, contact_id, stage_id, opportunity, currency_id
           FROM deals WHERE company_id = $1 ORDER BY date_modify DESC NULLS LAST LIMIT 300`,
        [id],
      ),
      query(
        `SELECT id, title, company_id, contact_id, status_id
           FROM leads WHERE company_id = $1 ORDER BY date_modify DESC NULLS LAST LIMIT 300`,
        [id],
      ),
    ]);

    if (!companyRes.rows.length) return res.status(404).json({ error: 'Компания не найдена' });

    const nodes = [
      companyNode(companyRes.rows[0]),
      ...contactsRes.rows.map(contactNode),
      ...dealsRes.rows.map((row) => dealNode(row, meta)),
      ...leadsRes.rows.map((row) => leadNode(row, meta)),
    ];
    const links = [];

    for (const contact of contactsRes.rows) {
      links.push({
        source: `company-${id}`,
        target: `contact-${contact.id}`,
        label: 'сотрудник',
      });
    }
    for (const deal of dealsRes.rows) {
      const source =
        deal.contact_id && contactsRes.rows.some((c) => Number(c.id) === Number(deal.contact_id))
          ? `contact-${deal.contact_id}`
          : `company-${id}`;
      links.push({ source, target: `deal-${deal.id}`, label: 'сделка' });
    }
    for (const lead of leadsRes.rows) {
      const source =
        lead.contact_id && contactsRes.rows.some((c) => Number(c.id) === Number(lead.contact_id))
          ? `contact-${lead.contact_id}`
          : `company-${id}`;
      links.push({ source, target: `lead-${lead.id}`, label: 'лид' });
    }

    res.json({ nodes, links });
  } catch (err) {
    next(err);
  }
});

/** Обзорный граф: топ компаний по количеству контактов + их контакты. */
graphRouter.get('/graph/overview', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);

    const companies = await query(
      `SELECT c.id, c.title, count(ct.id)::int AS contacts_count
         FROM companies c
         JOIN contacts ct ON ct.company_id = c.id
        GROUP BY c.id, c.title
        ORDER BY contacts_count DESC
        LIMIT $1`,
      [limit],
    );

    if (!companies.rows.length) return res.json({ nodes: [], links: [] });

    const ids = companies.rows.map((row) => row.id);
    const contacts = await query(
      `SELECT id, title, company_id FROM contacts
        WHERE company_id = ANY($1::bigint[])
        ORDER BY company_id, date_modify DESC NULLS LAST`,
      [ids],
    );

    const nodes = [
      ...companies.rows.map((row) => ({ ...companyNode(row), size: row.contacts_count })),
      ...contacts.rows.map(contactNode),
    ];
    const links = contacts.rows.map((row) => ({
      source: `company-${row.company_id}`,
      target: `contact-${row.id}`,
      label: 'сотрудник',
    }));

    res.json({ nodes, links });
  } catch (err) {
    next(err);
  }
});
