import { Router, Request, Response } from 'express';
import { getDbPool, getRedisClient } from '../services';
import { register } from 'prom-client';

const router = Router();

// Liveness probe - is the service running?
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe - is the service ready to accept traffic?
router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, boolean> = {};
  let allHealthy = true;

  // Check database
  try {
    const pool = getDbPool();
    const result = await pool.query('SELECT 1');
    checks.database = result.rowCount === 1;
  } catch (error) {
    checks.database = false;
    allHealthy = false;
  }

  // Check Redis
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    checks.redis = pong === 'PONG';
  } catch (error) {
    checks.redis = false;
    allHealthy = false;
  }

  const status = allHealthy ? 200 : 503;
  res.status(status).json({
    status: allHealthy ? 'ready' : 'not ready',
    checks,
    timestamp: new Date().toISOString()
  });
});

// Startup probe - has the service completed initialization?
router.get('/startup', async (_req: Request, res: Response) => {
  // Similar to readiness but more lenient during startup
  try {
    const pool = getDbPool();
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'started', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'starting', timestamp: new Date().toISOString() });
  }
});

export { router as healthRouter };
