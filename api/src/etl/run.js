import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { pool } from '../db.js';
import { fetchAll, fetchWindow, sleep } from '../bitrix.js';
import { ensureSchema } from './schema.js';
import { loadEntityFields, loadStatuses, saveFields, saveStatuses } from './fields.js';
import { ENTITY_LIST, transformRow } from './transform.js';
import { loadDealProductRows, refreshProductRows } from './productrows.js';
import {
  getCursor,
  getModifiedCursor,
  insertPage,
  markSync,
  resetCursor,
  setModifiedCursor,
} from './load.js';

const noop = () => {};

/** Выгрузку остановили пользователем (не ошибка). */
export class StopRequested extends Error {
  constructor() {
    super('Выгрузка остановлена пользователем');
    this.name = 'StopRequested';
  }
}

/** Пауза/стоп между запросами. control.check() вызывается перед каждой страницей. */
const checkControl = async (control) => {
  if (control?.check) await control.check();
};

async function loadMetadata({ control, onEvent, entityList }) {
  const metaByEntity = new Map();

  for (const entity of entityList) {
    await checkControl(control);
    const meta = await loadEntityFields(entity.key, entity.fieldsMethod);
    await saveFields(meta);
    metaByEntity.set(entity.key, meta);
    onEvent({
      type: 'meta',
      entity: entity.key,
      fields: meta.rows.length,
      userFields: meta.ufKeys.length,
      enums: meta.enums.length,
    });
    await sleep(config.sleepMs);
  }

  await checkControl(control);
  const statuses = await loadStatuses();
  await saveStatuses(statuses);
  onEvent({ type: 'meta-statuses', count: statuses.length });

  return metaByEntity;
}

const MULTIFIELD_SELECT = {
  company: ['PHONE', 'EMAIL'],
  contact: ['PHONE', 'EMAIL'],
  lead: ['PHONE', 'EMAIL'],
  deal: [],
};

const selectFor = (entity, meta) => ['*', ...meta.ufKeys, ...(MULTIFIELD_SELECT[entity.key] || [])];

async function loadEntity(entity, meta, { full, control, onEvent, limit }) {
  const select = selectFor(entity, meta);
  const resumeFrom = full ? 0 : await getCursor(entity.key);

  if (full) await resetCursor(entity.key);

  onEvent({
    type: 'entity-start',
    entity: entity.key,
    resumeFrom,
    selectCount: select.length,
    limit: limit || null,
  });

  await markSync(entity.key, 'running');
  const startedAt = Date.now();

  const { fetched, total, lastId } = await fetchAll(entity.method, {
    select,
    resumeFrom,
    maxItems: limit || null,
    beforeRequest: control?.check ? () => control.check() : undefined,
    onPage: async (items, info) => {
      const rows = items.map((raw) => transformRow(entity.key, raw));
      await insertPage(entity, rows, {
        total: info.total,
        lastId: info.lastId,
        fetched: items.length,
      });

      onEvent({
        type: 'page',
        entity: entity.key,
        page: info.page,
        lastId: info.lastId,
        total: info.total,
        fetched: info.fetched,
      });
    },
  });

  const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));

  onEvent({
    type: 'entity-done',
    entity: entity.key,
    fetched,
    seconds,
    lastId,
    total,
  });

  await markSync(entity.key, 'done');
  // всё, что изменится после старта этой выгрузки, заберёт дельта по DATE_MODIFY
  await setModifiedCursor(entity.key, new Date(startedAt).toISOString());
}

/**
 * Дельта правок: забираем записи с DATE_MODIFY >= курсора (с перекрытием),
 * чтобы подхватывать изменения существующих карточек, а не только новые ID.
 */
async function loadModified(entity, meta, { control, onEvent, overlapMinutes }) {
  const cursor = await getModifiedCursor(entity.key);
  const overlap = Number(overlapMinutes ?? process.env.ETL_MODIFIED_OVERLAP_MIN ?? 5);
  const since = cursor
    ? new Date(new Date(cursor).getTime() - overlap * 60_000)
    : new Date(Date.now() - 7 * 86_400_000);
  const runStartedAt = new Date();
  const select = selectFor(entity, meta);
  const startedAt = Date.now();

  onEvent({ type: 'modified-start', entity: entity.key, since: since.toISOString() });

  const { fetched, total } = await fetchWindow(entity.method, {
    select,
    filter: { '>=DATE_MODIFY': since.toISOString() },
    order: { DATE_MODIFY: 'ASC', ID: 'ASC' },
    beforeRequest: control?.check ? () => control.check() : undefined,
    onPage: async (items, info) => {
      const rows = items.map((raw) => transformRow(entity.key, raw));
      await insertPage(entity, rows, null);
      onEvent({
        type: 'modified-page',
        entity: entity.key,
        page: info.page,
        fetched: info.fetched,
        total: info.total,
      });
    },
  });

  await setModifiedCursor(entity.key, runStartedAt.toISOString());
  onEvent({
    type: 'modified-done',
    entity: entity.key,
    fetched,
    total,
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  });
}

/**
 * Полный цикл выгрузки. Используется и CLI, и API (кнопки в интерфейсе).
 *
 * @param {object}   options
 * @param {boolean}  options.full      полная перевыгрузка (иначе инкрементально)
 * @param {object}   options.control   { check(): Promise<void> } — пауза/стоп
 * @param {Function} options.onEvent   колбэк прогресса
 * @param {object}   options.limits    { company?: number, contact?: number, deal?: number } — максимум записей
 * @param {string[]} options.entities  список сущностей (по умолчанию все три)
 */
export async function runEtl({
  full = false,
  modified = false,
  control = null,
  onEvent = noop,
  limits = {},
  entities = null,
} = {}) {
  if (!config.bitrixWebhookUrl) {
    throw new Error(
      'BITRIX_WEBHOOK_URL не задан. Создайте .env (см. .env.example) и укажите ссылку входящего вебхука.',
    );
  }

  const entityList = Array.isArray(entities) && entities.length
    ? ENTITY_LIST.filter((entity) => entities.includes(entity.key))
    : ENTITY_LIST;

  if (!entityList.length) throw new Error('Не выбрано ни одной сущности для выгрузки');

  // Лимит по каждой сущности: { company: 1000, contact: 1000 }
  const entityLimits = Object.fromEntries(
    entityList.map((entity) => [entity.key, Number(limits[entity.key]) > 0 ? Number(limits[entity.key]) : null]),
  );

  onEvent({ type: 'start', full });
  await ensureSchema();

  // Сбрасываем курсоры всех выбранных сущностей сразу: если полная выгрузка
  // оборвётся и её повторят в режиме продолжения, остаток всё равно начнётся с 0.
  if (full) {
    for (const entity of entityList) await resetCursor(entity.key);
  }
  onEvent({ type: 'schema-ready' });

  // Псевдо-сущности (состав сделок) не имеют crm.*.fields — грузятся своим загрузчиком
  const metaByEntity = await loadMetadata({
    control,
    onEvent,
    entityList: entityList.filter((entity) => !entity.custom),
  });
  await sleep(config.entityPauseMs);

  let failed = 0;

  for (const entity of entityList) {
    try {
      await checkControl(control);
      if (entity.custom) {
        await loadDealProductRows({
          full,
          control,
          onEvent,
          limit: entityLimits[entity.key],
        });
      } else {
        await loadEntity(entity, metaByEntity.get(entity.key), {
          full,
          control,
          onEvent,
          limit: entityLimits[entity.key],
        });
      }
    } catch (err) {
      if (err?.name === 'StopRequested') {
        await markSync(entity.key, 'stopped').catch(() => {});
        onEvent({ type: 'stopped', entity: entity.key });
        return { stopped: true, failed };
      }
      failed += 1;
      onEvent({ type: 'entity-error', entity: entity.key, error: err.message });
      await markSync(entity.key, 'error', err.message).catch(() => {});
    }
    await sleep(config.entityPauseMs);
  }

  if (modified && !full && !failed) {
    for (const entity of entityList) {
      try {
        await checkControl(control);
        if (entity.custom) {
          await refreshProductRows({ control, onEvent, overlapMinutes: undefined });
          continue;
        }
        await loadModified(entity, metaByEntity.get(entity.key), {
          control,
          onEvent,
          overlapMinutes: undefined,
        });
      } catch (err) {
        if (err?.name === 'StopRequested') {
          onEvent({ type: 'stopped', entity: entity.key });
          return { stopped: true, failed };
        }
        onEvent({ type: 'modified-error', entity: entity.key, error: err.message });
        failed += 1;
      }
      await sleep(config.entityPauseMs);
    }
  }

  onEvent({ type: 'done', failed, entities: entityList.length });
  return { stopped: false, failed, attempted: entityList.length };
}

// ---------------------------------------------------------------------------
// CLI: node src/etl/run.js [--full]
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const hit = args.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
  };

  const full = Boolean(flag('full'));
  const modified = Boolean(flag('modified'));

  // --limit=1000  -> по 1000 записей на каждую выбранную сущность
  const limitRaw = flag('limit');
  const limit = limitRaw && limitRaw !== true ? Number(limitRaw) : null;
  const limits = limit && limit > 0
    ? Object.fromEntries(ENTITY_LIST.map((entity) => [entity.key, limit]))
    : {};

  // --only=company,contact
  const onlyRaw = flag('only');
  const entities = onlyRaw && onlyRaw !== true
    ? String(onlyRaw).split(',').map((item) => item.trim()).filter(Boolean)
    : null;

  const onEvent = (event) => {
    switch (event.type) {
      case 'start':
        console.log('[etl] старт', event.full ? '(полная перевыгрузка)' : '(инкрементально)');
        break;
      case 'schema-ready':
        console.log('[etl] схема БД готова');
        break;
      case 'meta':
        console.log(
          `[etl][meta] ${event.entity}: полей ${event.fields}, UF_* ${event.userFields}, значений справочников ${event.enums}`,
        );
        break;
      case 'meta-statuses':
        console.log(`[etl][meta] crm.status.list: ${event.count} значений`);
        break;
      case 'entity-start':
        console.log(
          `[etl][${event.entity}] select: ${event.selectCount} полей | ` +
            (event.resumeFrom ? `продолжаем с ID > ${event.resumeFrom}` : 'полная выгрузка') +
            (event.limit ? ` | лимит ${event.limit}` : ''),
        );
        break;
      case 'page':
        if (event.page % 10 === 0) {
          const progress = event.total ? `${event.lastId}/${event.total}` : String(event.lastId);
          console.log(`[etl][${event.entity}] страница ${event.page}, ID ${progress}`);
        }
        break;
      case 'entity-done':
        console.log(
          `[etl][${event.entity}] готово: ${event.fetched} записей за ${event.seconds}s, last_id=${event.lastId}` +
            (event.total ? ` (total ${event.total})` : ''),
        );
        break;
      case 'entity-error':
        console.error(`[etl][${event.entity}] ОШИБКА: ${event.error}`);
        break;
      case 'stopped':
        console.log('[etl] остановлено пользователем');
        break;
      case 'modified-start':
        console.log(`[etl][${event.entity}] дельта правок с ${event.since}`);
        break;
      case 'modified-done':
        console.log(
          `[etl][${event.entity}] дельта: ${event.fetched} изменённых за ${event.seconds}s` +
            (event.total ? ` (всего ${event.total})` : ''),
        );
        break;
      case 'modified-error':
        console.error(`[etl][${event.entity}] ошибка дельты: ${event.error}`);
        break;
      case 'done':
        console.log(
          event.failed
            ? `[etl] завершено с ошибками: ${event.failed} из ${event.entities}`
            : '[etl] выгрузка завершена',
        );
        break;
      default:
        break;
    }
  };

  const result = await runEtl({ full, modified, onEvent, limits, entities });
  if (result.failed || result.stopped) process.exitCode = result.failed ? 1 : 0;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  main()
    .catch((err) => {
      console.error('[etl] фатальная ошибка:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}
