import { Router } from 'express';
import { getSyncStatus, pauseSync, resumeSync, startSync, stopSync } from '../sync.js';

export const syncRouter = Router();

syncRouter.get('/sync/status', (_req, res) => {
  res.json(getSyncStatus());
});

/**
 * body: { full?: boolean, modified?: boolean, limit?: number, limits?: object, entities?: string[] }
 * modified: true — после инкремента догрузить правки существующих записей (DATE_MODIFY).
 * Ответ 202 сразу, сама выгрузка идёт в фоне; прогресс — GET /api/sync/status.
 */
syncRouter.post('/sync/start', (req, res, next) => {
  try {
    res.status(202).json(
      startSync({
        full: Boolean(req.body?.full),
        modified: req.body?.modified !== false,
        limit: req.body?.limit ?? null,
        limits: req.body?.limits ?? null,
        entities: Array.isArray(req.body?.entities) ? req.body.entities : null,
      }),
    );
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/sync/pause', (_req, res, next) => {
  try {
    res.json(pauseSync());
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/sync/resume', (_req, res, next) => {
  try {
    res.json(resumeSync());
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/sync/stop', (_req, res, next) => {
  try {
    res.json(stopSync());
  } catch (err) {
    next(err);
  }
});
