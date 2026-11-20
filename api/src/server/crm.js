import { pool } from '../db.js';

/**
 * Кэш метаданных CRM: поля, расшифровки enumeration и статусов.
 * Живёт 60 секунд — ETL может обновлять справочники на ходу.
 */
const TTL_MS = 60_000;
let cache = null;

const STATUS_CODES = new Set([
  'SOURCE_ID',
  'STATUS_ID',
  'STAGE_ID',
  'INDUSTRY',
  'COMPANY_TYPE',
  'EMPLOYEES',
  'CONTACT_TYPE',
  'DEAL_TYPE',
  'CURRENCY_ID',
  'LEAD_STATUS_ID',
]);

const SKIP_FIELDS = new Set(['ID', 'PHONE', 'EMAIL', 'WEB', 'IM', 'COMPANY_IDS', 'CONTACT_IDS']);

export async function getMeta(force = false) {
  if (cache && !force && Date.now() - cache.at < TTL_MS) return cache.data;

  const [fieldsRes, enumRes, statusRes] = await Promise.all([
    pool.query(
      'SELECT entity, field_code, field_name, type, is_custom, is_multiple, items FROM bitrix_fields',
    ),
    pool.query('SELECT entity, field_code, enum_id, value, sort FROM bitrix_enum ORDER BY sort, value'),
    pool.query('SELECT entity_id, status_id, name, sort FROM crm_status'),
  ]);

  const fields = {};
  const enums = new Map();
  const enumItems = new Map();
  const statuses = new Map();
  const statusByCode = new Map();

  for (const row of fieldsRes.rows) {
    const def = {
      code: row.field_code,
      label: row.field_name || row.field_code,
      type: row.type,
      isCustom: row.is_custom,
      isMultiple: row.is_multiple,
      items: row.items,
    };
    (fields[row.entity] ??= {})[row.field_code] = def;
  }

  for (const row of enumRes.rows) {
    const enumKey = `${row.entity}|${row.field_code}`;
    enums.set(`${enumKey}|${row.enum_id}`, row.value);
    if (!enumItems.has(enumKey)) enumItems.set(enumKey, []);
    enumItems.get(enumKey).push({ id: String(row.enum_id), value: row.value });
  }

  for (const row of statusRes.rows) {
    statuses.set(`${row.entity_id}|${row.status_id}`, row.name);
    // Один и тот же SOURCE_ID встречается в разных ENTITY_ID — нужен общий fallback
    if (!statusByCode.has(row.status_id)) statusByCode.set(row.status_id, row.name);
  }

  const data = { fields, enums, enumItems, statuses, statusByCode, loadedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

export function isEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function decodeEnum(meta, entity, fieldCode, id) {
  if (id === null || id === undefined || id === '') return null;
  const text = String(id);
  return (
    meta.enums.get(`${entity}|${fieldCode}|${text}`) ??
    meta.statusByCode.get(text) ??
    text
  );
}

export function decodeStatus(meta, statusId) {
  if (!statusId) return statusId;
  return meta.statusByCode.get(String(statusId)) ?? String(statusId);
}

function decodeScalar(meta, entity, fieldCode, type, value) {
  if (value && typeof value === 'object') {
    if ('VALUE' in value) {
      const suffix = value.VALUE_TYPE ? ` (${value.VALUE_TYPE})` : '';
      return `${value.VALUE}${suffix}`;
    }
    return null;
  }

  const text = String(value);

  if (type === 'boolean') {
    const upper = text.toUpperCase();
    if (upper === 'Y') return 'Да';
    if (upper === 'N') return 'Нет';
  }

  if (type === 'enumeration' || type === 'crm_status' || STATUS_CODES.has(fieldCode)) {
    return decodeEnum(meta, entity, fieldCode, text);
  }

  return text;
}

/** Значение поля CRM (в т.ч. множественного) -> человекочитаемая строка. */
export function decodeValue(meta, entity, fieldCode, def, value) {
  if (isEmptyValue(value)) return null;
  const type = def?.type || '';

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => decodeScalar(meta, entity, fieldCode, type, item))
      .filter((item) => item !== null && item !== '');
    return parts.length ? parts.join(', ') : null;
  }

  return decodeScalar(meta, entity, fieldCode, type, value);
}

/**
 * Полный профиль записи: все непустые поля из raw, включая кастомные UF_*,
 * с расшифровкой справочников и статусов.
 */
export function describeEntity(meta, entity, raw) {
  const defs = meta.fields[entity] || {};
  const out = [];
  const known = new Set();
  const source = raw || {};

  for (const [code, def] of Object.entries(defs)) {
    known.add(code);
    if (SKIP_FIELDS.has(code)) continue;
    const value = decodeValue(meta, entity, code, def, source[code]);
    if (value === null) continue;
    out.push({
      code,
      label: def.label,
      type: def.type,
      isCustom: Boolean(def.isCustom),
      value,
    });
  }

  for (const [code, rawValue] of Object.entries(source)) {
    if (known.has(code) || SKIP_FIELDS.has(code)) continue;
    const value = decodeValue(meta, entity, code, null, rawValue);
    if (value === null) continue;
    out.push({
      code,
      label: code,
      type: typeof rawValue === 'string' ? 'string' : 'json',
      isCustom: code.startsWith('UF_'),
      value,
    });
  }

  return out.sort(
    (a, b) => Number(a.isCustom) - Number(b.isCustom) || a.label.localeCompare(b.label, 'ru'),
  );
}
