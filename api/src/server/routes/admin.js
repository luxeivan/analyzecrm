import { spawn } from 'node:child_process';
import { Router } from 'express';
import { config } from '../../config.js';
import { query } from '../../db.js';
import { getServiceState } from '../../etl/load.js';
import { getSyncStatus } from '../sync.js';

export const adminRouter = Router();

/** Запуск служебного скрипта ETL отдельным процессом (сверка/эмбеддинги). */
function spawnScript(script) {
  const child = spawn(process.execPath, [`src/etl/${script}`], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

adminRouter.get('/admin/overview', async (_req, res, next) => {
  try {
    const [db, tables, indexes, deleted, embedState, reconcileState] = await Promise.all([
      query(`SELECT version() AS version, pg_database_size(current_database())::bigint AS size`),
      query(`SELECT 'companies' AS table, count(*)::int AS rows, count(embedding)::int AS embedded,
                    count(*) FILTER (WHERE synced_at > now() - interval '24 hours')::int AS fresh
               FROM companies
             UNION ALL
             SELECT 'contacts', count(*), count(embedding),
                    count(*) FILTER (WHERE synced_at > now() - interval '24 hours') FROM contacts
             UNION ALL
             SELECT 'deals', count(*), count(embedding),
                    count(*) FILTER (WHERE synced_at > now() - interval '24 hours') FROM deals
             UNION ALL
             SELECT 'leads', count(*), count(embedding),
                    count(*) FILTER (WHERE synced_at > now() - interval '24 hours') FROM leads`),
      query(`SELECT tablename AS table, indexname AS index
               FROM pg_indexes
              WHERE indexname LIKE '%embedding%'`),
      query(`SELECT count(*)::int AS count FROM deleted_records`),
      getServiceState('embed'),
      getServiceState('reconcile'),
    ]);

    res.json({
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      postgres: {
        version: String(db.rows[0].version).split(' ').slice(0, 2).join(' '),
        sizeBytes: Number(db.rows[0].size),
      },
      tables: tables.rows,
      vectorIndexes: indexes.rows,
      deletedRecords: deleted.rows[0].count,
      embed: embedState ? JSON.parse(embedState) : null,
      lastReconcile: reconcileState ? JSON.parse(reconcileState) : null,
      sync: getSyncStatus(),
      settings: {
        sleepMs: config.sleepMs,
        pageLimit: config.pageLimit,
        maxRetries: config.maxRetries,
        autoRetry: config.autoRetry,
        entityPauseMs: config.entityPauseMs,
        syncScheduler: config.syncScheduler,
        syncIntervalMin: config.syncIntervalMin,
        reconcileDays: config.reconcileDays,
        embeddingModel: config.embeddingModel,
        bitrixConfigured: Boolean(config.bitrixWebhookUrl),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Ручной запуск служебных задач: embed (векторизация) и reconcile (сверка удалённых). */
adminRouter.post('/admin/actions/:name', async (req, res, next) => {
  try {
    const { name } = req.params;

    if (name === 'embed') {
      const state = await getServiceState('embed');
      const parsed = state ? JSON.parse(state) : null;
      const running =
        parsed && !parsed.finishedAt && parsed.updatedAt
          ? Date.now() - new Date(parsed.updatedAt).getTime() < 120_000
          : false;
      if (running) return res.status(409).json({ error: 'Векторизация уже выполняется' });
      spawnScript('embed.js');
      return res.status(202).json({ started: true, action: 'embed' });
    }

    if (name === 'reconcile') {
      spawnScript('reconcile.js');
      return res.status(202).json({ started: true, action: 'reconcile' });
    }

    res.status(404).json({ error: 'Неизвестное действие' });
  } catch (err) {
    next(err);
  }
});
