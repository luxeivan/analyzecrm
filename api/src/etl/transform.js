import { config } from '../config.js';
import {
  buildSearchText,
  multiValues,
  toNumberOrNull,
  toText,
  toTimestamp,
} from './fields.js';

/**
 * Описание выгружаемых сущностей.
 * columns — порядок колонок в INSERT (см. api/src/sql/schema.sql).
 */
export const ENTITIES = {
  company: {
    key: 'company',
    table: 'companies',
    method: 'crm.company.list',
    fieldsMethod: 'crm.company.fields',
    columns: [
      'id',
      'title',
      'industry_id',
      'source_id',
      'assigned_by_id',
      'city',
      'region',
      'phones',
      'emails',
      'search_text',
      'raw',
      'date_create',
      'date_modify',
      'synced_at',
    ],
  },
  contact: {
    key: 'contact',
    table: 'contacts',
    method: 'crm.contact.list',
    fieldsMethod: 'crm.contact.fields',
    columns: [
      'id',
      'title',
      'name',
      'last_name',
      'second_name',
      'company_id',
      'source_id',
      'assigned_by_id',
      'phones',
      'emails',
      'search_text',
      'raw',
      'date_create',
      'date_modify',
      'synced_at',
    ],
  },
  lead: {
    key: 'lead',
    table: 'leads',
    method: 'crm.lead.list',
    fieldsMethod: 'crm.lead.fields',
    columns: [
      'id',
      'title',
      'name',
      'last_name',
      'second_name',
      'company_id',
      'contact_id',
      'status_id',
      'source_id',
      'opportunity',
      'currency_id',
      'assigned_by_id',
      'search_text',
      'raw',
      'date_create',
      'date_modify',
      'synced_at',
    ],
  },
  deal: {
    key: 'deal',
    table: 'deals',
    method: 'crm.deal.list',
    fieldsMethod: 'crm.deal.fields',
    columns: [
      'id',
      'title',
      'company_id',
      'contact_id',
      'stage_id',
      'category_id',
      'opportunity',
      'currency_id',
      'assigned_by_id',
      'search_text',
      'raw',
      'date_create',
      'date_modify',
      'synced_at',
    ],
  },
};

export const ENTITY_LIST = Object.values(ENTITIES);

const json = (value) => JSON.stringify(value ?? []);

export function contactTitle(raw) {
  const parts = [raw.LAST_NAME, raw.NAME, raw.SECOND_NAME]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' ') : `Контакт #${raw.ID}`;
}

/** API-запись -> строка values для bulk insert. */
export function transformRow(entityKey, raw) {
  const dateCreate = toTimestamp(raw.DATE_CREATE);
  const dateModify = toTimestamp(raw.DATE_MODIFY);
  const phones = json(multiValues(raw, 'PHONE'));
  const emails = json(multiValues(raw, 'EMAIL'));
  const searchText = buildSearchText(raw);
  const syncedAt = new Date();

  switch (entityKey) {
    case 'company':
      return [
        Number(raw.ID),
        toText(raw.TITLE) || `Компания #${raw.ID}`,
        toText(raw.INDUSTRY),
        toText(raw.SOURCE_ID),
        toNumberOrNull(raw.ASSIGNED_BY_ID),
        toText(raw.ADDRESS_CITY) || toText(raw.ADDRESS_LEGAL_CITY) || toText(raw.ADDRESS),
        config.regionField
          ? toText(raw[config.regionField])
          : toText(raw.ADDRESS_PROVINCE) || toText(raw.ADDRESS_REGION),
        phones,
        emails,
        searchText,
        JSON.stringify(raw),
        dateCreate,
        dateModify,
        syncedAt,
      ];

    case 'contact':
      return [
        Number(raw.ID),
        contactTitle(raw),
        toText(raw.NAME),
        toText(raw.LAST_NAME),
        toText(raw.SECOND_NAME),
        toNumberOrNull(raw.COMPANY_ID ?? raw.COMPANY_IDS?.[0]),
        toText(raw.SOURCE_ID),
        toNumberOrNull(raw.ASSIGNED_BY_ID),
        phones,
        emails,
        searchText,
        JSON.stringify(raw),
        dateCreate,
        dateModify,
        syncedAt,
      ];

    case 'lead':
      return [
        Number(raw.ID),
        toText(raw.TITLE) || contactTitle(raw) || `Лид #${raw.ID}`,
        toText(raw.NAME),
        toText(raw.LAST_NAME),
        toText(raw.SECOND_NAME),
        toNumberOrNull(raw.COMPANY_ID),
        toNumberOrNull(raw.CONTACT_ID),
        toText(raw.STATUS_ID),
        toText(raw.SOURCE_ID),
        toNumberOrNull(raw.OPPORTUNITY),
        toText(raw.CURRENCY_ID),
        toNumberOrNull(raw.ASSIGNED_BY_ID),
        searchText,
        JSON.stringify(raw),
        dateCreate,
        dateModify,
        syncedAt,
      ];

    case 'deal':
      return [
        Number(raw.ID),
        toText(raw.TITLE) || `Сделка #${raw.ID}`,
        toNumberOrNull(raw.COMPANY_ID),
        toNumberOrNull(raw.CONTACT_ID ?? raw.CONTACT_IDS?.[0]),
        toText(raw.STAGE_ID),
        toText(raw.CATEGORY_ID),
        toNumberOrNull(raw.OPPORTUNITY),
        toText(raw.CURRENCY_ID),
        toNumberOrNull(raw.ASSIGNED_BY_ID),
        searchText,
        JSON.stringify(raw),
        dateCreate,
        dateModify,
        syncedAt,
      ];

    default:
      throw new Error(`Неизвестная сущность: ${entityKey}`);
  }
}
