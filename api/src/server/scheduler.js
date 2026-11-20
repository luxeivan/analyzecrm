import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getServiceState, setServiceState } from '../etl/load.js';
import { getSyncStatus, startSync } from './sync.js';

const ACTIVE = ['running', 'pausing', 'paused', 'stopping'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Планировщик регулярной синхронизации внутри процесса API.
 *
 * Цикл (SYNC_INTERVAL_MIN, по умолчанию 15 мин):
 *   1. инкремент новых записей + дельта правок по DATE_MODIFY (runEtl modified);
 *   2. векторизация только новых/изменённых карточек (embed.js);
 *   3. раз в RECONCILE_DAYS дней — сверка удалённых (reconcile.js).
 *
 * Включается SYNC_SCHEDULER=1. Пока идёт ручная выгрузка, шаг пропускается.
 */
export function startScheduler(log = console.log) {
  if (process.env.SYNC_SCHEDULER !== '1') {
    log('[scheduler] выключен (SYNC_SCHEDULER != 1)');
    return;
  }

  const intervalMin = Math.max(5, Number(process.env.SYNC_INTERVAL_MIN || 15));
  const reconcileDays = Math.max(1, Number(process.env.RECONCILE_DAYS || 7));
  let busy = false;

  const waitIdle = async (timeoutMs = 2 * 60 * 60_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(3000);
      if (!ACTIVE.includes(getSyncStatus().status)) return true;
    }
    return false;
  };

  const runScript = (relativePath) =>
    new Promise((resolve, reject) => {
      const file = fileURLToPath(new URL(relativePath, import.meta.url));
      const child = spawn(process.execPath, [file], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

      const forward = (stream, prefix) => {
        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += String(chunk);
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) log(`[scheduler]${prefix} ${line.trim()}`);
        });
      };
      forward(child.stdout, '');
      forward(child.stderr, ' ERR');

      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${relativePath}: код ${code}`))));
    });

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (ACTIVE.includes(getSyncStatus().status)) {
        log('[scheduler] синхронизация уже идёт — пропускаем');
        return;
      }

      log('[scheduler] старт: новые записи + дельта правок');
      startSync({ modified: true });
      const finished = await waitIdle();

      if (!finished) {
        log('[scheduler] синхронизация не завершилась за 2 часа — выходим из цикла');
        return;
      }

      if (process.env.POLZA_TOKEN || process.env.LLM_API_KEY) {
        log('[scheduler] векторизация новых и изменённых записей');
        await runScript('../etl/embed.js');
      }

      const last = await getServiceState('reconcile');
      const stale = !last || Date.now() - new Date(last).getTime() > reconcileDays * 86_400_000;
      if (stale) {
        log(`[scheduler] сверка удалённых (раз в ${reconcileDays} дн.)`);
        await runScript('../etl/reconcile.js');
        await setServiceState('reconcile', new Date().toISOString());
      }
    } catch (error) {
      log('[scheduler] ошибка:', error.message);
    } finally {
      busy = false;
    }
  };

  // первый запуск через минуту после старта, дальше — по интервалу
  setTimeout(tick, 60_000);
  setInterval(tick, intervalMin * 60_000);
  log(`[scheduler] включён: каждые ${intervalMin} мин, сверка удалённых раз в ${reconcileDays} дн.`);
}
