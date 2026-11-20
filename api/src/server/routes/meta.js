import { Router } from 'express';
import { query } from '../../db.js';
import { getMeta } from '../crm.js';

export const metaRouter = Router();

const ENTITIES = ['company', 'contact', 'deal', 'lead'];

// Какие статусы показывать в выпадающем списке для конкретного поля
const STATUS_FILTER = {
  SOURCE_ID: "entity_id IN ('SOURCE', 'COMPANY_SOURCE', 'CONTACT_SOURCE', 'LEAD_SOURCE')",
  STAGE_ID: "entity_id LIKE 'DEAL_STAGE%'",
  STATUS_ID: "entity_id = 'STATUS'",
};

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: String(item.ID ?? item.id ?? item.ENUM_ID ?? ''),
      value: String(item.VALUE ?? item.value ?? item.NAME ?? ''),
    }))
    .filter((item) => item.id && item.value);
}

async function loadStatusItems(code) {
  const condition = STATUS_FILTER[code];
  const { rows } = await query(
    `SELECT DISTINCT status_id AS id, name AS value FROM crm_status
      ${condition ? `WHERE ${condition}` : ''}
      ORDER BY name`,
  );
  return rows.filter((row) => row.id && row.value);
}

/** Список полей сущности + значения справочников (для фильтров и карточки). */
metaRouter.get('/fields', async (req, res, next) => {
  try {
    const entity = ENTITIES.includes(String(req.query.entity)) ? String(req.query.entity) : 'company';
    const meta = await getMeta(req.query.refresh === '1');
    const defs = Object.values(meta.fields[entity] || {});

    const statusItems = new Map();
    for (const code of new Set(defs.map((def) => def.code))) {
      if (STATUS_FILTER[code]) statusItems.set(code, await loadStatusItems(code));
    }

    const fields = defs.map((def) => {
      const decoded = meta.enumItems.get(`${entity}|${def.code}`);
      let items = decoded?.length ? decoded : normalizeItems(def.items);
      // SOURCE_ID / STAGE_ID / STATUS_ID живут в crm_status
      if (!items.length && statusItems.has(def.code)) items = statusItems.get(def.code) ?? [];

      return {
        code: def.code,
        label: def.label,
        type: def.type,
        isCustom: Boolean(def.isCustom),
        isMultiple: Boolean(def.isMultiple),
        items,
      };
    });

    res.json({ entity, fields, updatedAt: meta.loadedAt });
  } catch (err) {
    next(err);
  }
});
