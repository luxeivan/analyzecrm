import express from 'express';
import cors from 'cors';
import { config } from '../config.js';
import { pool } from '../db.js';
import { ensureSchema } from '../etl/schema.js';
import { metaRouter } from './routes/meta.js';
import { entitiesRouter } from './routes/entities.js';
import { graphRouter } from './routes/graph.js';
import { statsRouter } from './routes/stats.js';
import { analyticsRouter } from './routes/analytics.js';
import { embedRouter } from './routes/embed.js';
import { adminRouter } from './routes/admin.js';
import { searchRouter } from './routes/search.js';
import { duplicatesRouter } from './routes/duplicates.js';
import { aiRouter } from './routes/ai.js';
import { syncRouter } from './routes/sync.js';
import { startScheduler } from './scheduler.js';
import { authRouter } from './routes/auth.js';
import { ensureSystemAdmin, requireAdmin, requireAuth } from '../auth.js';

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS now');
    res.json({ ok: true, db: rows[0].now, uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Авторизация: /health и /auth/login открыты, всё остальное — по JWT.
app.use('/api', requireAuth);
app.use('/api', authRouter);

// Разделы только для администратора.
app.use('/api/admin', requireAdmin);
app.use('/api/sync', requireAdmin);
app.use('/api/embed', requireAdmin);

app.use('/api', metaRouter);
app.use('/api', entitiesRouter);
app.use('/api', graphRouter);
app.use('/api', statsRouter);
app.use('/api', analyticsRouter);
app.use('/api', embedRouter);
app.use('/api', adminRouter);
app.use('/api', searchRouter);
app.use('/api', duplicatesRouter);
app.use('/api', aiRouter);
app.use('/api', syncRouter);

app.use((_req, res) => res.status(404).json({ error: 'Эндпоинт не найден' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.statusCode || (err.code === 'ECONNREFUSED' ? 503 : 500);
  // 4xx — ожидаемые ответы (конфликт состояния выгрузки и т.п.), не засоряем лог стеком
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Внутренняя ошибка' });
});

async function start() {
  try {
    await ensureSchema();
    console.log('[api] схема БД готова');
    await ensureSystemAdmin();
  } catch (err) {
    console.warn('[api] схема не создана (БД недоступна?):', err.message);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[api] http://0.0.0.0:${config.port}/api`);
    startScheduler();
  });
}

async function shutdown(signal) {
  console.log(`[api] ${signal}, останавливаемся`);
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
