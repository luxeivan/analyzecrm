import { sleep } from '../bitrix.js';
import { runEtl, StopRequested } from '../etl/run.js';
import { ENTITY_LIST } from '../etl/transform.js';

/**
 * Менеджер выгрузки: один активный job на процесс API.
 * Пауза и стоп — кооперативные: ETL проверяет флаги перед каждым запросом страницы,
 * поэтому остановка происходит максимум через один запрос (~1 c).
 */

const MAX_LOG_LINES = 40;

let pauseRequested = false;
let stopRequested = false;
let running = false;

const state = {
  status: 'idle', // idle | running | pausing | paused | stopping | stopped | done | error
  full: false,
  startedAt: null,
  finishedAt: null,
  entity: null,
  page: 0,
  lastId: 0,
  total: null,
  fetched: 0,
  message: null,
  error: null,
  progress: [],
  log: [],
};

const httpError = (code, message) => {
  const err = new Error(message);
  err.statusCode = code;
  return err;
};

const progressFor = (entity) => {
  let row = state.progress.find((item) => item.entity === entity);
  if (!row) {
    row = { entity, status: 'pending', fetched: 0, total: null, lastId: 0, error: null };
    state.progress.push(row);
  }
  return row;
};

const pushLog = (text) => {
  state.log.push(`${new Date().toLocaleTimeString('ru-RU')} ${text}`);
  if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
};

async function check() {
  while (pauseRequested && !stopRequested) {
    state.status = 'paused';
    state.message = 'Пауза';
    await sleep(500);
  }

  if (stopRequested) throw new StopRequested();

  if (state.status === 'paused') {
    state.status = 'running';
    state.message = null;
  }
}

function handleEvent(event) {
  switch (event.type) {
    case 'start':
      state.status = 'running';
      state.message = 'Подготовка…';
      pushLog(`Старт выгрузки${event.full ? ' (полная)' : ''}`);
      break;

    case 'meta':
      state.message = `Метаданные: ${event.entity} (${event.fields} полей)`;
      break;

    case 'entity-start': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'running', fetched: 0, total: null, lastId: event.resumeFrom, error: null });
      state.entity = event.entity;
      state.page = 0;
      state.fetched = 0;
      state.lastId = event.resumeFrom;
      state.total = null;
      state.message = `Выгрузка: ${event.entity}`;
      pushLog(
        `${event.entity}: ${event.resumeFrom ? `продолжаем с ID > ${event.resumeFrom}` : 'с нуля'}`,
      );
      break;
    }

    case 'page': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'running', fetched: event.fetched, total: event.total, lastId: event.lastId });
      state.page = event.page;
      state.lastId = event.lastId;
      state.total = event.total;
      state.fetched = event.fetched;
      break;
    }

    case 'entity-done': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'done', fetched: event.fetched, total: event.total ?? row.total, lastId: event.lastId });
      pushLog(
        `${event.entity}: ${event.fetched} записей за ${event.seconds}s` +
          (event.total ? ` (всего ${event.total})` : ''),
      );
      break;
    }

    case 'entity-error': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'error', error: event.error });
      pushLog(`${event.entity}: ошибка — ${event.error}`);
      break;
    }

    case 'modified-start': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'delta', fetched: 0, error: null });
      state.entity = event.entity;
      state.page = 0;
      state.fetched = 0;
      state.total = null;
      state.message = `Дельта правок: ${event.entity}`;
      pushLog(`${event.entity}: дельта правок с ${new Date(event.since).toLocaleString('ru-RU')}`);
      break;
    }

    case 'modified-page': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'delta', fetched: event.fetched, total: event.total });
      state.page = event.page;
      state.fetched = event.fetched;
      state.total = event.total;
      break;
    }

    case 'modified-done': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'done', fetched: event.fetched, total: event.total ?? row.total });
      pushLog(
        `${event.entity}: дельта — ${event.fetched} изменённых за ${event.seconds}s` +
          (event.total ? ` (всего ${event.total})` : ''),
      );
      break;
    }

    case 'modified-error': {
      const row = progressFor(event.entity);
      Object.assign(row, { status: 'error', error: event.error });
      pushLog(`${event.entity}: ошибка дельты — ${event.error}`);
      break;
    }

    default:
      break;
  }
}

export function getSyncStatus() {
  return { ...state, log: [...state.log], progress: state.progress.map((row) => ({ ...row })) };
}

export function isSyncRunning() {
  return running;
}

export function startSync({ full = false, modified = false, limit = null, limits = null, entities = null } = {}) {
  if (running) throw httpError(409, 'Выгрузка уже запущена');

  const selected = Array.isArray(entities) && entities.length ? entities : null;
  const keys = (selected ? ENTITY_LIST.filter((e) => selected.includes(e.key)) : ENTITY_LIST).map(
    (e) => e.key,
  );
  if (!keys.length) {
    throw httpError(400, `Неизвестные сущности. Доступны: ${ENTITY_LIST.map((e) => e.key).join(', ')}`);
  }

  const maxItems = Number(limit) > 0 ? Number(limit) : null;
  // limits: { company: 1000, contact: 1000, deal: 0 } — приоритетнее общего limit
  const perEntity = limits && typeof limits === 'object' ? limits : null;
  const entityLimits = {};
  for (const key of keys) {
    const value = perEntity ? Number(perEntity[key]) : maxItems;
    if (Number.isFinite(value) && value > 0) entityLimits[key] = Math.floor(value);
  }

  running = true;
  pauseRequested = false;
  stopRequested = false;

  Object.assign(state, {
    status: 'running',
    full: Boolean(full),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    entity: null,
    page: 0,
    lastId: 0,
    total: null,
    fetched: 0,
    message: 'Подготовка…',
    error: null,
    progress: keys.map((entity) => ({
      entity,
      status: 'pending',
      fetched: 0,
      total: null,
      lastId: 0,
      error: null,
    })),
    log: [],
  });

  const waitWithControl = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await check(); // пауза/стоп работают и во время ожидания
      await sleep(1000);
    }
  };

  const runWithRetries = async () => {
    const maxRetries = Math.max(0, Number(process.env.ETL_AUTO_RETRY ?? 10));
    const baseDelayMin = Math.max(1, Number(process.env.ETL_AUTO_RETRY_DELAY_MIN ?? 3));
    let attempt = 0;
    let useFull = Boolean(full);
    let lastError = null;

    for (;;) {
      try {
        const result = await runEtl({
          full: useFull,
          modified,
          control: { check },
          onEvent: handleEvent,
          limits: entityLimits,
          entities: selected,
        });
        if (result.stopped) return result;
        if (!result.failed) return result;
        lastError = new Error(`Ошибки в ${result.failed} из ${result.attempted ?? '?'} сущностей`);
      } catch (err) {
        if (err?.name === 'StopRequested') throw err;
        lastError = err;
      }

      attempt += 1;
      if (attempt > maxRetries) throw lastError;

      const fatal = /BITRIX_WEBHOOK_URL|401|403|404|Не задан|Некорректн/i.test(
        String(lastError?.bitrixError || lastError?.message || ''),
      );
      if (fatal) throw lastError;

      // 429 OPERATION_TIME_LIMIT обычно отпускает за 1–5 минут; ждём с запасом
      const delayMs = baseDelayMin * 60_000 * Math.min(attempt, 2);
      pushLog(
        `Повтор ${attempt}/${maxRetries} через ${Math.round(delayMs / 60_000)} мин: ${lastError.message}`,
      );
      state.message = `Ожидание повтора ${attempt}/${maxRetries}`;
      await waitWithControl(delayMs);
      useFull = false; // дальше продолжаем с сохранённых курсоров, без повторного сброса
    }
  };

  runWithRetries()
    .then((result) => {
      if (result.stopped) {
        state.status = 'stopped';
        state.message = 'Остановлено';
      } else if (result.failed) {
        state.status = 'error';
        state.error = `Ошибки в ${result.failed} из ${result.attempted ?? '?'} сущностей`;
        state.message = 'Выгрузка прервана из-за ошибки — смотрите журнал';
      } else {
        state.status = 'done';
        state.message = 'Выгрузка завершена';
        pushLog('Выгрузка завершена');
      }
    })
    .catch((err) => {
      if (err?.name === 'StopRequested') {
        state.status = 'stopped';
        state.message = 'Остановлено';
        pushLog('Остановлено пользователем');
      } else {
        state.status = 'error';
        state.error = err.message;
        pushLog(`Критическая ошибка: ${err.message}`);
      }
    })
    .finally(() => {
      running = false;
      pauseRequested = false;
      stopRequested = false;
      state.finishedAt = new Date().toISOString();
      if (['running', 'pausing', 'stopping'].includes(state.status)) state.status = 'idle';
    });

  return getSyncStatus();
}

export function pauseSync() {
  if (!running) throw httpError(409, 'Выгрузка не запущена');
  if (pauseRequested) return getSyncStatus();

  pauseRequested = true;
  state.status = 'pausing';
  state.message = 'Пауза после текущей страницы…';
  pushLog('Запрошена пауза');
  return getSyncStatus();
}

export function resumeSync() {
  if (!running) throw httpError(409, 'Выгрузка не запущена');
  if (!pauseRequested) return getSyncStatus();

  pauseRequested = false;
  state.status = 'running';
  state.message = null;
  pushLog('Продолжаем');
  return getSyncStatus();
}

export function stopSync() {
  if (!running) throw httpError(409, 'Выгрузка не запущена');

  stopRequested = true;
  pauseRequested = false;
  state.status = 'stopping';
  state.message = 'Останавливаем…';
  pushLog('Запрошена остановка');
  return getSyncStatus();
}
