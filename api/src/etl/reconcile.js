import { call } from '../bitrix.js';
import { pool, query } from '../db.js';
import { ensureSchema } from './schema.js';

/**
 * Сверка удалённых записей: Bitrix24 не отдаёт удалённые через list,
 * поэтому раз в неделю забираем все ID батчами (50 команд × 50 записей за запрос)
 * и удаляем из Postgres то, чего в CRM больше нет. Удалённое складываем в deleted_records.
 *
 * Запуск:
 *   node src/etl/reconcile.js [--only=company,contact,deal,lead] [--dry]
 */

const ENTITIES = {
  company: { method: 'crm.company.list', table: 'companies' },
  contact: { method: 'crm.contact.list', table: 'contacts' },
  deal: { method: 'crm.deal.list', table: 'deals' },
  lead: { method: 'crm.lead.list', table: 'leads' },
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE = 50;
const COMMANDS = 50;

/** Все ID сущности в CRM через batch (по 2 500 ID за запрос). */
async function fetchIds(method) {
  const first = await call(method, { select: ['ID'], start: 0 });
  const total = Number(first.total ?? 0);
  if (!total) return { ids: new Set(), total: 0 };

  const ids = new Set((first.result ?? []).map((item) => Number(item.ID)));

  for (let start = PAGE; start < total; start += PAGE * COMMANDS) {
    const cmd = {};
    for (let i = 0; i < COMMANDS; i += 1) {
      cmd[`l${i}`] = `${method}?start=${start + i * PAGE}&select[0]=ID`;
    }

    const res = await call('batch', { cmd, halt: 0 });
    const result = res?.result?.result ?? res?.result ?? {};
    let got = 0;

    for (let i = 0; i < COMMANDS; i += 1) {
      for (const item of result[`l${i}`] ?? []) {
        ids.add(Number(item.ID));
        got += 1;
      }
    }

    if (!got) break;
    await sleep(300);
  }

  return { ids, total };
}

async function reconcileEntity(key) {
  const entity = ENTITIES[key];
  const { ids, total } = await fetchIds(entity.method);

  if (!total) {
    console.log(`[reconcile][${key}] CRM вернула 0 записей — пропускаем (защита от массового удаления)`);
    return { deleted: 0 };
  }
  if (ids.size < total * 0.9) {
    console.log(
      `[reconcile][${key}] получили ${ids.size} из ${total} ID — прерываем сверку (неполная выборка)`,
    );
    return { deleted: 0 };
  }

  const { rows } = await query(`SELECT id, title FROM ${entity.table} ORDER BY id`);
  const missing = rows.filter((row) => !ids.has(Number(row.id)));

  console.log(
    `[reconcile][${key}] в CRM ${total}, в БД ${rows.length}, отсутствуют ${missing.length}`,
  );
  if (!missing.length) return { deleted: 0 };

  if (dry) {
    console.log(
      `[reconcile][${key}] dry-run: удалили бы ${missing.length} (${missing
        .slice(0, 5)
        .map((row) => `#${row.id} ${row.title ?? ''}`.trim())
        .join('; ')}${missing.length > 5 ? '…' : ''})`,
    );
    return { deleted: 0 };
  }

  const idsToDelete = missing.map((row) => Number(row.id));
  const { rows: raws } = await query(
    `SELECT id, title, raw FROM ${entity.table} WHERE id = ANY($1::bigint[])`,
    [idsToDelete],
  );

  await query(
    `INSERT INTO deleted_records (entity, id, title, raw)
     SELECT $1, t.id, t.title, t.raw
       FROM ${entity.table} t
      WHERE t.id = ANY($2::bigint[])
     ON CONFLICT (entity, id) DO UPDATE SET deleted_at = now(), raw = EXCLUDED.raw`,
    [key, idsToDelete],
  );
  await query(`DELETE FROM ${entity.table} WHERE id = ANY($1::bigint[])`, [idsToDelete]);

  console.log(`[reconcile][${key}] удалено ${raws.length} записей (сохранены в deleted_records)`);
  return { deleted: raws.length };
}

async function main() {
  await ensureSchema();
  const keys = (only?.length ? only : Object.keys(ENTITIES)).filter((key) => ENTITIES[key]);
  if (!keys.length) {
    console.error('Неизвестные сущности. Доступно: company, contact, deal, lead');
    process.exitCode = 1;
    return;
  }

  let totalDeleted = 0;
  for (const key of keys) {
    const { deleted } = await reconcileEntity(key);
    totalDeleted += deleted;
    await sleep(500);
  }

  console.log(`[reconcile] готово${dry ? ' (dry-run)' : ''}: удалено ${totalDeleted}`);
}

main()
  .catch((error) => {
    console.error('[reconcile] ошибка:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
