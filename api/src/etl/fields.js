import { pool } from '../db.js';
import { call } from '../bitrix.js';

// ENTITY_ID для crm.userfield.list
const USERFIELD_ENTITY = {
  company: 'CRM_COMPANY',
  contact: 'CRM_CONTACT',
  deal: 'CRM_DEAL',
  lead: 'CRM_LEAD',
  product: 'CRM_PRODUCT',
  product_section: 'CRM_PRODUCT_SECTION',
};

/** Рекурсивно собирает все скалярные значения (для поиска по любым полям). */
export function flattenValues(value, out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenValues(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenValues(item, out);
    return out;
  }
  const text = String(value).trim();
  if (text) out.push(text);
  return out;
}

export function buildSearchText(raw) {
  // Ограничение ~20k символов: в поиске не нужны простыни, индекс не раздуваем
  return flattenValues(raw).join(' ').slice(0, 20_000);
}

/** Мультиполя Битрикса: [{ VALUE, VALUE_TYPE }] -> [{ value, type }] */
export function multiValues(raw, key) {
  const list = Array.isArray(raw?.[key]) ? raw[key] : [];
  return list
    .map((item) => ({
      value: String(item?.VALUE ?? '').trim(),
      type: String(item?.VALUE_TYPE ?? '').trim(),
    }))
    .filter((item) => item.value);
}

export function toTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toText(value, max = 512) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Метаданные полей сущности: crm.<entity>.fields + crm.userfield.list.
 * Возвращает:
 *  - rows:    строки для bitrix_fields
 *  - enums:   строки для bitrix_enum (расшифровка enumeration)
 *  - ufKeys:  все UF_* поля для select
 */
export async function loadEntityFields(entity, fieldsMethod) {
  const defs = new Map(); // field_code -> { def, items }

  const fieldsRes = await call(fieldsMethod);
  for (const [code, def] of Object.entries(fieldsRes.result || {})) {
    if (!def || typeof def !== 'object') continue;
    defs.set(code, {
      def,
      items: Array.isArray(def.items) ? def.items : [],
    });
  }

  // crm.<entity>.fields отдаёт типы, но варианты справочника (LIST) надёжнее в userfield.list
  const ufEntity = USERFIELD_ENTITY[entity];
  if (ufEntity) try {
    const ufRes = await call('crm.userfield.list', {
      filter: { ENTITY_ID: ufEntity },
    });
    for (const uf of ufRes.result || []) {
      const code = uf.FIELD_NAME;
      if (!code) continue;
      const def = {
        type: uf.USER_TYPE_ID,
        title: uf.EDIT_FORM_LABEL || uf.LIST_COLUMN_LABEL || code,
        isMultiple: uf.MULTIPLE === 'Y',
      };
      const items = Array.isArray(uf.LIST) ? uf.LIST : [];
      const existing = defs.get(code);
      defs.set(code, {
        def: existing?.def || def,
        items: items.length ? items : existing?.items || [],
      });
    }
  } catch (err) {
    console.warn(`[etl] ${entity}: crm.userfield.list недоступен (${err.message})`);
  }

  const rows = [];
  const enums = [];
  const ufKeys = [];

  for (const [code, { def, items }] of defs) {
    const isCustom = code.startsWith('UF_');
    if (isCustom) ufKeys.push(code);

    const type = String(def.type || def.USER_TYPE_ID || 'string');
    const label = def.formLabel || def.title || def.EDIT_FORM_LABEL || code;
    const isMultiple = def.isMultiple === true || def.MULTIPLE === 'Y';

    rows.push([
      entity,
      code,
      label,
      type,
      isCustom,
      isMultiple,
      items.length ? items : null,
      def,
    ]);

    for (const item of items) {
      const id = item.ID ?? item.id ?? item.ENUM_ID;
      const value = item.VALUE ?? item.value ?? item.NAME;
      if (id === undefined || value === undefined) continue;
      enums.push([entity, code, String(id), String(value), Number(item.SORT) || 0]);
    }
  }

  return { entity, rows, enums, ufKeys: [...new Set(ufKeys)] };
}

/** crm.status.list — человекочитаемые SOURCE_ID / STAGE_ID / INDUSTRY / ... */
export async function loadStatuses() {
  const res = await call('crm.status.list', {});
  return (res.result || [])
    .filter((s) => s.STATUS_ID)
    .map((s) => [
      String(s.ENTITY_ID || ''),
      String(s.STATUS_ID),
      toText(s.NAME) || String(s.STATUS_ID),
      Number(s.SORT) || 0,
      toText(s.SEMANTICS),
    ]);
}

export async function saveFields({ entity, rows, enums }) {
  await upsert(entity, rows, {
    table: 'bitrix_fields',
    columns: ['entity', 'field_code', 'field_name', 'type', 'is_custom', 'is_multiple', 'items', 'raw'],
    onConflict: '(entity, field_code)',
  });

  await upsert(entity, enums, {
    table: 'bitrix_enum',
    columns: ['entity', 'field_code', 'enum_id', 'value', 'sort'],
    onConflict: '(entity, field_code, enum_id)',
  });
}

export async function saveStatuses(rows) {
  await upsert('status', rows, {
    table: 'crm_status',
    columns: ['entity_id', 'status_id', 'name', 'sort', 'semantics'],
    onConflict: '(entity_id, status_id)',
  });
}

// pg сериализует массивы как array-literal, а нам нужен jsonb -> stringify вручную
const serialize = (value) =>
  value !== null && typeof value === 'object' && !(value instanceof Date)
    ? JSON.stringify(value)
    : value;

// Пакетный upsert через мультиVALUES: 50 строк * 8 колонок = 400 параметров, лимит PG 65535
async function upsert(_label, rows, { table, columns, onConflict }) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    const params = [];
    const tuples = rows.map(
      (row) => `(${row.map((value) => `$${params.push(serialize(value))}`).join(', ')})`,
    );
    const updates = columns
      .filter((col) => !onConflict.includes(col))
      .map((col) => `${col} = EXCLUDED.${col}`)
      .join(', ');

    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}
       ON CONFLICT ${onConflict} DO UPDATE SET ${updates}`,
      params,
    );
  } finally {
    client.release();
  }
}
