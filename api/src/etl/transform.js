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
  product: {
    key: 'product',
    table: 'products',
    method: 'crm.product.list',
    fieldsMethod: 'crm.product.fields',
    columns: [
      'id',
      'name',
      'section_id',
      'price',
      'currency_id',
      'measure',
      'active',
      'code',
      'vat_id',
      'description',
      'search_text',
      'raw',
      'date_create',
      'date_modify',
      'synced_at',
    ],
  },
  product_section: {
    key: 'product_section',
    table: 'product_sections',
    method: 'crm.productsection.list',
    fieldsMethod: 'crm.productsection.fields',
    // sections: keyset (>ID) у этого метода не работает — портал игнорирует фильтр,
    // поэтому разделы (их ~1000) тянем offset-пагинацией, как окно дельты
    pagination: 'offset',
    columns: ['id', 'name', 'parent_id', 'sort', 'raw', 'synced_at'],
  },
  // Состав сделок: собственной таблицы-страницы нет, загрузчик в etl/productrows.js
  deal_products: {
    key: 'deal_products',
    table: 'deal_product_rows',
    custom: true,
  },
};

export const ENTITY_LIST = Object.values(ENTITIES);

/** Колонки строк товаров в сделке (порядок важен: см. schema.sql). */
export const DEAL_PRODUCT_ROW_COLUMNS = [
  'deal_id',
  'line_id',
  'product_id',
  'product_name',
  'price',
  'price_netto',
  'price_account',
  'quantity',
  'discount_sum',
  'discount_rate',
  'tax_rate',
  'measure_name',
  'type',
  'raw',
];

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

    case 'product':
      return [
        Number(raw.ID),
        toText(raw.NAME) || `Товар #${raw.ID}`,
        toNumberOrNull(raw.SECTION_ID),
        toNumberOrNull(raw.PRICE),
        toText(raw.CURRENCY_ID),
        toText(raw.MEASURE),
        String(raw.ACTIVE ?? 'Y').toUpperCase() !== 'N',
        toText(raw.CODE),
        toNumberOrNull(raw.VAT_ID),
        toText(raw.DESCRIPTION, 4000),
        searchText,
        JSON.stringify(raw),
        dateCreate,
        dateModify,
        syncedAt,
      ];

    case 'product_section':
      return [
        Number(raw.ID),
        toText(raw.NAME) || `Раздел #${raw.ID}`,
        toNumberOrNull(raw.SECTION_ID),
        toNumberOrNull(raw.SORT),
        JSON.stringify(raw),
        syncedAt,
      ];

    default:
      throw new Error(`Неизвестная сущность: ${entityKey}`);
  }
}

/**
 * Строка товара в сделке (crm.deal.productrows.get) -> массив values
 * в порядке DEAL_PRODUCT_ROW_COLUMNS.
 */
export function transformProductRow(dealId, raw, index = 0) {
  const lineId = toNumberOrNull(raw.ID) ?? index + 1;
  return [
    Number(dealId),
    lineId,
    toNumberOrNull(raw.PRODUCT_ID) || null,
    toText(raw.PRODUCT_NAME) || toText(raw.ORIGINAL_PRODUCT_NAME) || 'Товар',
    toNumberOrNull(raw.PRICE),
    toNumberOrNull(raw.PRICE_EXCLUSIVE),
    toNumberOrNull(raw.PRICE_ACCOUNT),
    toNumberOrNull(raw.QUANTITY),
    toNumberOrNull(raw.DISCOUNT_SUM),
    toNumberOrNull(raw.DISCOUNT_RATE),
    toNumberOrNull(raw.TAX_RATE),
    toText(raw.MEASURE_NAME),
    toNumberOrNull(raw.TYPE),
    JSON.stringify(raw),
  ];
}
