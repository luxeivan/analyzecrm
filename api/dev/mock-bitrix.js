/**
 * Мок Битрикс24 для локальной проверки ETL без реального портала.
 *
 *   node dev/mock-bitrix.js
 *   BITRIX_WEBHOOK_URL=http://localhost:5099/rest/1/token npx node src/etl/run.js
 *
 * Отдаёт crm.<entity>.fields, crm.userfield.list, crm.status.list и list-методы
 * с пагинацией по 50 и фильтром >ID — как настоящий REST.
 */
import express from 'express';

const app = express();
app.use(express.json());

const companies = Array.from({ length: 123 }, (_, i) => ({
  ID: String(i + 1),
  TITLE: `Компания ${i + 1}`,
  INDUSTRY: i % 2 ? 'MFG' : 'IT',
  SOURCE_ID: i % 3 ? 'CALL' : 'WEB',
  ADDRESS_CITY: ['Москва', 'Казань', 'Пермь'][i % 3],
  PHONE: [{ VALUE: `+7900000${String(i).padStart(4, '0')}`, VALUE_TYPE: 'WORK' }],
  EMAIL: [{ VALUE: `c${i + 1}@example.ru`, VALUE_TYPE: 'WORK' }],
  UF_CRM_SEGMENT: String((i % 2) + 1),
  DATE_CREATE: '2025-01-15T10:00:00+03:00',
  DATE_MODIFY: '2025-02-15T10:00:00+03:00',
}));

const contacts = Array.from({ length: 57 }, (_, i) => ({
  ID: String(i + 1),
  NAME: `Имя${i + 1}`,
  LAST_NAME: 'Фамилия',
  COMPANY_ID: String((i % 40) + 1),
  POST: 'Менеджер',
  PHONE: [{ VALUE: `+7911111${String(i).padStart(4, '0')}`, VALUE_TYPE: 'WORK' }],
  EMAIL: [{ VALUE: `p${i + 1}@example.ru`, VALUE_TYPE: 'WORK' }],
  DATE_CREATE: '2025-01-15T10:00:00+03:00',
  DATE_MODIFY: '2025-02-15T10:00:00+03:00',
}));

const deals = Array.from({ length: 33 }, (_, i) => ({
  ID: String(i + 1),
  TITLE: `Сделка ${i + 1}`,
  COMPANY_ID: String((i % 20) + 1),
  CONTACT_ID: String((i % 20) + 1),
  STAGE_ID: i % 2 ? 'WON' : 'NEW',
  OPPORTUNITY: String(10000 * (i + 1)),
  CURRENCY_ID: 'RUB',
  DATE_CREATE: '2025-01-15T10:00:00+03:00',
  DATE_MODIFY: '2025-02-15T10:00:00+03:00',
}));

const datasets = { 'crm.company.list': companies, 'crm.contact.list': contacts, 'crm.deal.list': deals };

const fields = {
  TITLE: { type: 'string', formLabel: 'Название' },
  INDUSTRY: { type: 'enumeration', formLabel: 'Отрасль', items: [{ ID: 'IT', VALUE: 'IT' }, { ID: 'MFG', VALUE: 'Производство' }] },
  SOURCE_ID: { type: 'crm_status', formLabel: 'Источник' },
  ADDRESS_CITY: { type: 'string', formLabel: 'Город' },
  PHONE: { type: 'crm_multifield', formLabel: 'Телефон' },
  EMAIL: { type: 'crm_multifield', formLabel: 'Email' },
  DATE_CREATE: { type: 'datetime', formLabel: 'Создано' },
  DATE_MODIFY: { type: 'datetime', formLabel: 'Изменено' },
  ID: { type: 'integer', formLabel: 'ID' },
  NAME: { type: 'string', formLabel: 'Имя' },
  LAST_NAME: { type: 'string', formLabel: 'Фамилия' },
  COMPANY_ID: { type: 'integer', formLabel: 'Компания' },
  POST: { type: 'string', formLabel: 'Должность' },
};

app.post('/rest/1/token/:method', (req, res) => {
  const method = req.params.method.replace(/\.json$/, '');
  const body = req.body || {};

  if (method === 'crm.company.fields') return res.json({ result: fields });
  if (method === 'crm.contact.fields') return res.json({ result: fields });
  if (method === 'crm.deal.fields') return res.json({ result: fields });
  if (method === 'crm.userfield.list') {
    return res.json({
      result: [
        {
          FIELD_NAME: 'UF_CRM_SEGMENT',
          USER_TYPE_ID: 'enumeration',
          EDIT_FORM_LABEL: 'Сегмент',
          MULTIPLE: 'N',
          LIST: [{ ID: '1', VALUE: 'Ключевой' }, { ID: '2', VALUE: 'Средний' }],
        },
      ],
    });
  }
  if (method === 'crm.status.list') {
    return res.json({
      result: [
        { ENTITY_ID: 'SOURCE', STATUS_ID: 'CALL', NAME: 'Звонок', SORT: 10 },
        { ENTITY_ID: 'SOURCE', STATUS_ID: 'WEB', NAME: 'Сайт', SORT: 20 },
        { ENTITY_ID: 'DEAL_STAGE', STATUS_ID: 'WON', NAME: 'Сделка успешна', SORT: 100 },
        { ENTITY_ID: 'DEAL_STAGE', STATUS_ID: 'NEW', NAME: 'Новая', SORT: 10 },
      ],
    });
  }

  const dataset = datasets[method];
  if (!dataset) return res.json({ error: 'ERROR_METHOD_NOT_FOUND', error_description: method });

  const filter = body.filter || {};
  const minId = Number(filter['>ID'] || 0);
  const filtered = dataset.filter((row) => Number(row.ID) > minId);

  if (body.start === -1) return res.json({ result: [], total: filtered.length, next: 50 });

  const page = filtered.slice(0, 50);
  res.json({ result: page, total: filtered.length, next: page.length === 50 ? 50 : undefined });
});

const port = Number(process.env.MOCK_PORT || 5099);
app.listen(port, () => console.log(`mock bitrix: http://localhost:${port}/rest/1/token`));
