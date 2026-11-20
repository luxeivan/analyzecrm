import { Router } from 'express';
import { getServiceState } from '../../etl/load.js';

export const embedRouter = Router();

/** Прогресс векторизации (пишет embed.js в service_state). */
embedRouter.get('/embed/status', async (_req, res, next) => {
  try {
    const value = await getServiceState('embed');
    if (!value) return res.json({ active: false });
    res.json({ active: true, ...JSON.parse(value) });
  } catch (err) {
    next(err);
  }
});
