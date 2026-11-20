import axios from 'axios';
import { config } from './config.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const http = axios.create({
  timeout: config.requestTimeoutMs,
  headers: { 'Content-Type': 'application/json' },
});

function webhookUrl(method) {
  if (!config.bitrixWebhookUrl) {
    throw new Error(
      'BITRIX_WEBHOOK_URL не задан. Скопируйте .env.example -> .env и вставьте ссылку входящего вебхука.',
    );
  }
  return `${config.bitrixWebhookUrl}/${method}.json`;
}

/**
 * Вызов метода REST с retry.
 * Ретраим только сетевые ошибки, 429, 5xx и "внутренние" ошибки портала.
 * Логические ошибки (доступ, неверный метод) — сразу наверх.
 */
export async function call(method, params = {}, attempt = 1) {
  try {
    const { data } = await http.post(webhookUrl(method), params);

    if (data?.error) {
      const err = new Error(`${method}: ${data.error_description || data.error}`);
      err.bitrixError = data.error;
      err.retryable = /INTERNAL|QUERY_LIMIT|OVERLOAD/i.test(String(data.error));
      throw err;
    }
    return data;
  } catch (err) {
    const status = err.response?.status;
    const retryable =
      err.retryable ||
      !status ||
      status === 429 ||
      status === 503 ||
      status >= 500;

    if (!retryable || attempt >= config.maxRetries) throw err;

    // 429/QUERY_LIMIT: портал просит притормозить. Уважаем Retry-After,
    // иначе ждём заметно дольше обычного backoff (5s, 10s, 15s…).
    const retryAfter = Number(err.response?.headers?.['retry-after']);
    const rateLimited = status === 429 || err.bitrixError === 'QUERY_LIMIT';
    const operationTimeLimit = err.bitrixError === 'OPERATION_TIME_LIMIT';

    const backoff = operationTimeLimit
      ? Math.min(30_000 * attempt, 120_000) // 30s, 60s, 90s… этот лимит живёт окном ~минуту
      : rateLimited
        ? Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 120_000)
          : Math.min(5_000 * attempt, 60_000)
        : config.sleepMs * attempt * 2;

    console.warn(
      `[bitrix] ${method}: ${status || err.code || err.message}` +
        ` -> retry ${attempt}/${config.maxRetries} через ${backoff}ms`,
    );
    await sleep(backoff);
    return call(method, params, attempt + 1);
  }
}

/**
 * total по фильтру.
 * start=-1 — «дешёвый» способ узнать total; но часть порталов отдаёт на него 0,
 * поэтому в fetchAll он используется только как fallback (обычные ответы Bitrix24
 * содержат total на каждой странице).
 */
/**
 * Обход выборки с фильтром (например, `>=DATE_MODIFY`) через `start`-пагинацию.
 * Используется для дельты правок: окно небольшое, поэтому offset безопасен,
 * а перекрытие окон компенсирует сдвиги во время обхода.
 */
export async function fetchWindow(
  method,
  { select = ['*'], filter = {}, order = {}, maxItems = null, beforeRequest, onPage } = {},
) {
  const pageSize = 50;
  let start = 0;
  let page = 0;
  let fetched = 0;
  let total = null;
  let lastId = 0;

  while (true) {
    if (beforeRequest) await beforeRequest();
    const res = await call(method, { select, filter, order, start });
    const items = Array.isArray(res.result) ? res.result : [];
    total = Number(res.total ?? 0) || total;
    page += 1;
    fetched += items.length;
    if (items.length) lastId = Number(items[items.length - 1].ID) || lastId;

    if (items.length && onPage) await onPage(items, { page, total, fetched, lastId });

    if (items.length < pageSize) break;
    if (maxItems && fetched >= maxItems) break;

    start += items.length;
    await sleep(config.sleepMs);
  }

  return { fetched, total, lastId, page };
}

export async function count(method, filter = {}) {
  const res = await call(method, { filter, select: ['ID'], start: -1 });
  return Number(res.total ?? 0) || null;
}

/**
 * Полный обход выборки.
 *
 * Схема пагинации (без OFFSET, чтобы не терять записи при изменениях в CRM):
 *   filter = { ...baseFilter, '>ID': lastId }, order = { ID: 'ASC' }, start: 0
 * После каждой страницы lastId := ID последней записи. total берём из ответа страницы
 * (Bitrix24 отдаёт его с учётом фильтра), start=-1 — только fallback для порталов,
 * которые не возвращают total на обычных запросах.
 *
 * @param {(items: object[], info: {page: number, lastId: number, total: number|null}) => Promise<void>} onPage
 */
export async function fetchAll(
  method,
  {
    select = ['*'],
    filter = {},
    order = { ID: 'ASC' },
    resumeFrom = 0,
    // Ограничение на количество записей (например, тестовая выгрузка 1000 штук).
    // Курсор двигается как обычно — следующий запуск продолжит с этого места.
    maxItems = null,
    onPage,
    // beforeRequest вызывается перед каждым запросом страницы:
    // так работают пауза и мягкая остановка выгрузки.
    beforeRequest,
  },
) {
  let total = null;
  let totalChecked = false;
  let lastId = Number(resumeFrom) || 0;
  let page = 0;
  let fetched = 0;

  for (;;) {
    if (maxItems && fetched >= maxItems) break;
    if (beforeRequest) await beforeRequest();

    const params = {
      select,
      order,
      filter: lastId ? { ...filter, '>ID': lastId } : { ...filter },
      start: 0,
    };

    const res = await call(method, params);
    const items = Array.isArray(res.result) ? res.result : [];

    // total обычно приходит на каждой странице; start=-1 — только fallback
    if (!totalChecked && items.length > 0) {
      totalChecked = true;
      if (typeof res.total === 'number' && res.total > 0) {
        total = res.total;
      } else {
        total = await count(method, filter).catch((err) => {
          console.warn(`[bitrix] ${method}: total недоступен (${err.message})`);
          return null;
        });
      }
      if (maxItems && total !== null) total = Math.min(total, maxItems);
    }

    if (items.length === 0) {
      if (total === null) total = typeof res.total === 'number' ? res.total : 0;
      break;
    }

    page += 1;

    // Не записываем лишнее, если задан maxItems
    let pageItems = items;
    if (maxItems) {
      const remaining = maxItems - fetched;
      if (pageItems.length > remaining) pageItems = pageItems.slice(0, Math.max(remaining, 0));
      if (pageItems.length === 0) break;
    }

    fetched += pageItems.length;
    const pageLastId = Number(pageItems[pageItems.length - 1].ID);
    if (!Number.isFinite(pageLastId) || pageLastId <= lastId) {
      throw new Error(`${method}: пагинация не двигается (lastId=${pageLastId}, предыдущий=${lastId})`);
    }

    await onPage(pageItems, { page, lastId: pageLastId, total, fetched });

    lastId = pageLastId;
    if (maxItems && fetched >= maxItems) break;
    if (items.length < config.pageLimit) break;
    await sleep(config.sleepMs);
  }

  return { fetched, total, lastId };
}
