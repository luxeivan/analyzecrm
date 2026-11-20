import { call } from '../bitrix.js';
import { query } from '../db.js';
import { decodeStatus, getMeta } from './crm.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Реальные даты сделок: DATE_CREATE у этого портала — дата миграции (февраль 2020),
 * поэтому бизнес-динамика считается по BEGINDATE (дата начала сделки).
 */
const beginDateSql = (prefix = '') =>
  `CASE WHEN ${prefix}raw->>'BEGINDATE' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (${prefix}raw->>'BEGINDATE')::timestamptz END`;

const BEGIN_DATE = beginDateSql();

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

let totalsCache = { at: 0, data: null };

/** Всего записей в портале (start=-1 на этом портале не работает — берём total обычной страницы). */
async function portalTotals() {
  if (totalsCache.data && Date.now() - totalsCache.at < 10 * 60_000) return totalsCache.data;

  const methods = {
    company: 'crm.company.list',
    contact: 'crm.contact.list',
    deal: 'crm.deal.list',
    lead: 'crm.lead.list',
  };
  const data = {};
  for (const [key, method] of Object.entries(methods)) {
    try {
      const res = await call(method, { select: ['ID'], start: 0 });
      data[key] = Number(res.total ?? 0) || null;
    } catch {
      data[key] = null;
    }
    await sleep(1200);
  }
  totalsCache = { at: Date.now(), data };
  return data;
}

export async function getAnalytics({ from = null, to = null } = {}) {
  const meta = await getMeta();

  const fromIso = from ? new Date(from).toISOString() : null;
  const toIso = to ? new Date(to).toISOString() : null;
  const bound = (expr) => {
    const parts = [];
    if (fromIso) parts.push(`${expr} >= '${fromIso}'::timestamptz`);
    if (toIso) parts.push(`${expr} < '${toIso}'::timestamptz`);
    return parts.join(' AND ');
  };
  const dealCond = bound(BEGIN_DATE);
  const dealCondD = bound(beginDateSql('d.'));
  const leadCond = bound('date_create');
  const dAnd = dealCond ? ` AND (${dealCond})` : '';
  const dAndAlias = dealCondD ? ` AND (${dealCondD})` : '';
  const lAnd = leadCond ? ` AND (${leadCond})` : '';
  const dealWhere = dealCond || 'TRUE';
  const leadWhere = leadCond || 'TRUE';

  const [
    dealTotals,
    dealYears,
    dealMonths,
    dealStages,
    leadTotals,
    leadStatuses,
    leadSources,
    topCompanies,
    cities,
    repeat,
    companies,
    contacts,
    leads,
    duplicates,
    lastSync,
  ] = await Promise.all([
    query(`SELECT count(*)::int AS count,
                  count(*) FILTER (WHERE stage_id = 'WON')::int AS won,
                  count(*) FILTER (WHERE stage_id = 'LOSE')::int AS lost,
                  count(*) FILTER (WHERE stage_id NOT IN ('WON', 'LOSE'))::int AS open,
                  count(*) FILTER (WHERE coalesce(opportunity, 0) = 0)::int AS zero_sum,
                  coalesce(sum(opportunity), 0)::float8 AS sum,
                  coalesce(sum(opportunity) FILTER (WHERE stage_id = 'WON'), 0)::float8 AS won_sum,
                  coalesce(sum(opportunity) FILTER (WHERE stage_id = 'LOSE'), 0)::float8 AS lost_sum,
                  coalesce(avg(opportunity) FILTER (WHERE opportunity > 0), 0)::float8 AS avg_deal,
                  count(*) FILTER (WHERE ${BEGIN_DATE} IS NULL)::int AS without_begin_date
             FROM deals
            WHERE ${dealWhere}`),
    query(`SELECT to_char(${BEGIN_DATE}, 'YYYY') AS year,
                  count(*)::int AS count,
                  count(*) FILTER (WHERE stage_id = 'WON')::int AS won,
                  coalesce(sum(opportunity) FILTER (WHERE stage_id = 'WON'), 0)::float8 AS won_sum,
                  coalesce(sum(opportunity), 0)::float8 AS sum
             FROM deals
            WHERE ${BEGIN_DATE} IS NOT NULL${dAnd}
            GROUP BY 1 ORDER BY 1`),
    query(`SELECT to_char(date_trunc('month', ${BEGIN_DATE}), 'YYYY-MM') AS month,
                  count(*)::int AS count,
                  coalesce(sum(opportunity) FILTER (WHERE stage_id = 'WON'), 0)::float8 AS won_sum,
                  coalesce(sum(opportunity), 0)::float8 AS sum
             FROM deals
            WHERE ${BEGIN_DATE} IS NOT NULL${dAnd}
            GROUP BY 1 ORDER BY 1`),
    query(`SELECT stage_id AS key, count(*)::int AS count, coalesce(sum(opportunity), 0)::float8 AS sum
             FROM deals WHERE ${dealWhere} GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT count(*)::int AS count,
                  count(*) FILTER (WHERE status_id = 'CONVERTED')::int AS converted,
                  count(*) FILTER (WHERE status_id = 'JUNK')::int AS junk,
                  count(*) FILTER (WHERE coalesce(opportunity, 0) = 0)::int AS zero_sum,
                  coalesce(sum(opportunity), 0)::float8 AS sum
             FROM leads WHERE ${leadWhere}`),
    query(`SELECT status_id AS key, count(*)::int AS count
             FROM leads WHERE coalesce(status_id, '') <> ''${lAnd}
            GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT source_id AS key,
                  count(*)::int AS total,
                  count(*) FILTER (WHERE status_id = 'CONVERTED')::int AS converted,
                  count(*) FILTER (WHERE status_id = 'JUNK')::int AS junk
             FROM leads WHERE coalesce(source_id, '') <> ''${lAnd}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    query(`SELECT d.company_id AS id, c.title, count(*)::int AS deals,
                  coalesce(sum(d.opportunity), 0)::float8 AS sum
             FROM deals d
             JOIN companies c ON c.id = d.company_id
            WHERE d.stage_id = 'WON'${dAndAlias}
            GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 10`),
    query(`SELECT coalesce(nullif(btrim(c.city), ''), 'Без города') AS city,
                  count(DISTINCT c.id)::int AS companies,
                  coalesce(sum(d.opportunity), 0)::float8 AS sum
             FROM companies c
             LEFT JOIN deals d ON d.company_id = c.id AND d.stage_id = 'WON'${dAndAlias}
            GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 12`),
    query(`WITH won AS (
             SELECT company_id, count(*) AS deals, sum(opportunity) AS sum
               FROM deals WHERE stage_id = 'WON' AND company_id IS NOT NULL${dealCond ? ` AND (${dealCond})` : ''}
              GROUP BY 1
           )
           SELECT count(*)::int AS companies,
                  count(*) FILTER (WHERE deals > 1)::int AS repeat_companies,
                  coalesce(sum(sum), 0)::float8 AS total_sum,
                  coalesce(sum(sum) FILTER (WHERE deals > 1), 0)::float8 AS repeat_sum
             FROM won`),
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE coalesce(city, '') = '')::int AS no_city,
                  count(*) FILTER (WHERE coalesce(industry_id, '') = '')::int AS no_industry,
                  count(*) FILTER (WHERE coalesce(source_id, '') = '')::int AS no_source,
                  count(*) FILTER (WHERE NOT (raw ? 'PHONE'))::int AS no_phone_exported,
                  count(*) FILTER (WHERE NOT (raw ? 'EMAIL'))::int AS no_email_exported,
                  count(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM contacts ct WHERE ct.company_id = companies.id))::int AS no_contacts
             FROM companies`),
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE company_id IS NULL)::int AS no_company,
                  count(*) FILTER (WHERE company_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM companies c WHERE c.id = contacts.company_id))::int AS company_not_loaded,
                  count(*) FILTER (WHERE NOT (raw ? 'PHONE'))::int AS no_phone_exported,
                  count(*) FILTER (WHERE NOT (raw ? 'EMAIL'))::int AS no_email_exported,
                  count(*) FILTER (WHERE coalesce(raw->>'POST', '') = '')::int AS no_position
             FROM contacts`),
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE company_id IS NULL)::int AS no_company,
                  count(*) FILTER (WHERE company_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM companies c WHERE c.id = leads.company_id))::int AS company_not_loaded,
                  count(*) FILTER (WHERE contact_id IS NULL)::int AS no_contact,
                  count(*) FILTER (WHERE coalesce(source_id, '') = '')::int AS no_source
             FROM leads`),
    query(`SELECT
             (SELECT count(*) FROM (
                SELECT lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS key
                  FROM companies
                 GROUP BY key HAVING count(*) > 1) t)::int AS company_title_groups,
             (SELECT coalesce(sum(c), 0)::int FROM (
                SELECT count(*) AS c
                  FROM companies
                 GROUP BY lower(regexp_replace(btrim(title), '\\s+', ' ', 'g'))
                HAVING count(*) > 1) t)::int AS company_title_rows,
             (SELECT count(*) FROM (
                SELECT lower(btrim(coalesce(last_name, '') || ' ' || coalesce(name, ''))) AS key
                  FROM contacts
                 GROUP BY key HAVING count(*) > 1) t)::int AS contact_name_groups,
             (SELECT coalesce(sum(c), 0)::int FROM (
                SELECT count(*) AS c
                  FROM contacts
                 GROUP BY lower(btrim(coalesce(last_name, '') || ' ' || coalesce(name, '')))
                HAVING count(*) > 1) t)::int AS contact_name_rows`),
    query(`SELECT max(synced_at) AS synced_at FROM (
             SELECT synced_at FROM companies UNION ALL SELECT synced_at FROM contacts
             UNION ALL SELECT synced_at FROM deals UNION ALL SELECT synced_at FROM leads) t`),
  ]);

  const deals = dealTotals.rows[0];
  const leadStats = leadTotals.rows[0];
  const totals = await portalTotals();

  const loaded = {
    company: companies.rows[0].total,
    contact: contacts.rows[0].total,
    deal: deals.count,
    lead: leads.rows[0].total,
  };
  const coverage = ['company', 'contact', 'deal', 'lead'].map((key) => ({
    entity: key,
    loaded: loaded[key],
    total: totals[key] ?? null,
    percent: totals[key] ? pct(loaded[key], totals[key]) : null,
  }));

  const stageNames = new Map();
  for (const [key, name] of meta.statuses) {
    if (key.startsWith('DEAL_STAGE') && key.includes('|')) {
      const id = key.split('|').pop();
      if (!stageNames.has(id)) stageNames.set(id, name);
    }
  }
  const stages = dealStages.rows.map((row) => ({
    key: row.key,
    name: row.key === 'WON' ? 'Успешна' : row.key === 'LOSE' ? 'Провалена' : decodeStatus(meta, row.key) ?? row.key,
    count: row.count,
    sum: row.sum,
  }));

  const leadByStatus = leadStatuses.rows.map((row) => ({
    key: row.key,
    name: decodeStatus(meta, row.key) ?? row.key,
    value: row.count,
  }));

  const sources = leadSources.rows.map((row) => ({
    key: row.key,
    name: decodeStatus(meta, row.key) ?? row.key,
    total: row.total,
    converted: row.converted,
    junk: row.junk,
    conversion: pct(row.converted, row.total),
  }));

  const quality = {
    companies: companies.rows[0],
    contacts: contacts.rows[0],
    leads: leads.rows[0],
    deals: {
      total: deals.count,
      no_company: null,
      no_contact: null,
      zero_sum: deals.zero_sum,
      open: deals.open,
      without_begin_date: deals.without_begin_date,
    },
    duplicates: duplicates.rows[0],
  };

  const [dealLinks] = await Promise.all([
    query(`SELECT count(*) FILTER (WHERE company_id IS NULL)::int AS no_company,
                  count(*) FILTER (WHERE contact_id IS NULL)::int AS no_contact,
                  count(*) FILTER (WHERE contact_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM contacts c WHERE c.id = deals.contact_id))::int AS contact_not_loaded,
                  count(*) FILTER (WHERE company_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM companies c WHERE c.id = deals.company_id))::int AS company_not_loaded
             FROM deals`),
  ]);
  quality.deals = { ...quality.deals, ...dealLinks.rows[0] };

  const winRate = pct(deals.won, deals.won + deals.lost);
  const repeatShare = pct(repeat.rows[0].repeat_sum, repeat.rows[0].total_sum);

  const recommendations = [];
  const push = (severity, title, detail, action) => recommendations.push({ severity, title, detail, action });

  if (coverage.some((row) => row.percent !== null && row.percent < 100)) {
    push(
      'high',
      'Данные выгружены не полностью',
      coverage
        .map((row) => `${row.entity}: ${row.loaded.toLocaleString('ru-RU')} из ${row.total?.toLocaleString('ru-RU') ?? '?'} (${row.percent ?? '?'}%)`)
        .join('; '),
      'Догрузить остаток по всем сущностям: выводы по выборке 10–12 тыс. записей смещены в сторону старых сделок.',
    );
  }
  if (quality.companies.no_phone_exported > 0) {
    push(
      'high',
      'Телефоны и email не выгружались',
      `${quality.companies.no_phone_exported.toLocaleString('ru-RU')} компаний без поля PHONE в raw-данных — в Bitrix это мультиполя, они не входят в select «*».`,
      'Добавить PHONE и EMAIL в select ETL (уже сделано) и перезагрузить/догрузить контакты и компании — без телефонов невозможна дедупликация и оценка связи с клиентом.',
    );
  }
  if (quality.companies.no_city > quality.companies.total * 0.5) {
    push(
      'high',
      'Нет географии клиентов',
      `${pct(quality.companies.no_city, quality.companies.total)}% компаний без города: поле city пустое, адрес лежит в ADDRESS_CITY/REG_ADDRESS_CITY и тоже почти не заполнен.`,
      'Включить в ETL разбор адресных полей (ADDRESS_CITY, REG_ADDRESS_CITY, UF_CRM_GEO_ADDRESS) и заполнить регион — это база для территориального анализа продаж.',
    );
  }
  if (quality.deals.no_contact > quality.deals.total * 0.3) {
    push(
      'high',
      'Сделки без контакта',
      `${pct(quality.deals.no_contact, quality.deals.total)}% сделок не привязаны к контакту — нельзя оценить ЛПР, повторные обращения и качество работы менеджеров.`,
      'Внедрить обязательное поле «Контакт» в карточке сделки и почистить исторические сделки.',
    );
  }
  if (quality.contacts.no_company > quality.contacts.total * 0.2) {
    push(
      'high',
      'Контакты без компании',
      `${pct(quality.contacts.no_company, quality.contacts.total)}% контактов не привязаны к компании (у части — ссылка на невыгруженную компанию: ${quality.contacts.company_not_loaded.toLocaleString('ru-RU')}).`,
      'После полной выгрузки пересчитать связки; для «сирот» завести правило: контакт без компании → создать/привязать компанию по email-домену или телефону.',
    );
  }
  if (quality.deals.zero_sum > quality.deals.total * 0.1) {
    push(
      'medium',
      'Сделки с нулевой суммой',
      `${quality.deals.zero_sum.toLocaleString('ru-RU')} сделок (${pct(quality.deals.zero_sum, quality.deals.total)}%) без суммы — выручка и средний чек занижены.`,
      'Проверить стадии, где сумма не обязательна, и заполнить исторические суммы; в отчётах считать средний чек только по сделкам с суммой > 0.',
    );
  }
  if (quality.leads.junk > quality.leads.total * 0.3) {
    push(
      'medium',
      'Много «мусорных» лидов',
      `${pct(quality.leads.junk, quality.leads.total)}% лидов в статусе JUNK (${quality.leads.junk.toLocaleString('ru-RU')} из ${quality.leads.total.toLocaleString('ru-RU')}).`,
      'Использовать лиды только для анализа источников и конверсии, а «мусор» — для обучения скоринга; в отчётах показывать конверсию без JUNK.',
    );
  }
  if (quality.duplicates.company_title_rows > 0) {
    push(
      'medium',
      'Дубли компаний по названию',
      `${quality.duplicates.company_title_rows} записей в ${quality.duplicates.company_title_groups} группах с одинаковым названием; дубли контактов: ${quality.duplicates.contact_name_rows}.`,
      'Сравнивать не только название, но и домен email/телефон/адрес; после загрузки PHONE/EMAIL запустить fuzzy-дедупликацию и pgvector-поиск похожих карточек.',
    );
  }
  if (deals.without_begin_date > 0) {
    push(
      'low',
      'Дата создания сделки — техническая',
      `${pct(deals.without_begin_date, deals.count)}% сделок без BEGINDATE; DATE_CREATE у всех записей — февраль 2020 (дата миграции в Bitrix).`,
      'Для динамики продаж использовать BEGINDATE/CLOSEDATE (уже учтено в этом отчёте), а не DATE_CREATE.',
    );
  }
  if (quality.companies.no_source === quality.companies.total) {
    push(
      'low',
      'Источник не заполнен у компаний',
      'SOURCE_ID пуст у 100% компаний — источники есть только у лидов и контактов.',
      'Анализировать каналы по лидам (см. блок «Источники лидов») и проставлять источник при конвертации лида в компанию.',
    );
  }
  if (repeatShare > 0) {
    push(
      'info',
      'Повторные продажи — точка роста',
      `${repeat.rows[0].repeat_companies.toLocaleString('ru-RU')} компаний с повторными успешными сделками дают ${repeatShare}% выручки (${Math.round(repeat.rows[0].repeat_sum).toLocaleString('ru-RU')} ₽).`,
      'Считать LTV по компании, строить напоминания о допродаже (мебель для новых офисов/филиалов) и сегментировать базу по числу сделок.',
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    dataAsOf: lastSync.rows[0]?.synced_at ?? null,
    period: { from: fromIso, to: toIso },
    coverage,
    deals: {
      count: deals.count,
      won: deals.won,
      lost: deals.lost,
      open: deals.open,
      zeroSum: deals.zero_sum,
      sum: deals.sum,
      wonSum: deals.won_sum,
      lostSum: deals.lost_sum,
      avgDeal: deals.avg_deal,
      winRate,
      stages,
    },
    years: dealYears.rows,
    months: dealMonths.rows,
    leads: {
      count: leadStats.count,
      converted: leadStats.converted,
      junk: leadStats.junk,
      conversion: pct(leadStats.converted, leadStats.count),
      sum: leadStats.sum,
      byStatus: leadByStatus,
    },
    sources,
    topCompanies: topCompanies.rows,
    cities: cities.rows,
    repeat: {
      companies: repeat.rows[0].companies,
      repeatCompanies: repeat.rows[0].repeat_companies,
      totalSum: repeat.rows[0].total_sum,
      repeatSum: repeat.rows[0].repeat_sum,
      share: repeatShare,
    },
    quality,
    recommendations,
  };
}
