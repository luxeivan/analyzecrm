import { Router } from 'express';
import { getAnalytics } from '../analytics.js';

export const analyticsRouter = Router();

analyticsRouter.get('/analytics/overview', async (req, res, next) => {
  try {
    const parseDate = (value) => {
      if (!value) return null;
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    res.json(
      await getAnalytics({
        from: parseDate(req.query.from),
        to: parseDate(req.query.to),
      }),
    );
  } catch (err) {
    next(err);
  }
});
