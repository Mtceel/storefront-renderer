import { getDbPool, getRedisClient } from './index';
import { logger } from '../utils/logger';

interface Tenant {
  id: string;
  tenant_id: string;
  name: string;
  custom_domain?: string;
  status: string;
}

/**
 * Resolve tenant from hostname
 * Priority: 
 * 1. Redis cache (fast path)
 * 2. Database lookup via domain_mapping
 * 3. Cache result in Redis
 */
export const getTenantFromHost = async (host: string): Promise<Tenant | null> => {
  const redis = getRedisClient();
  const cacheKey = `tenant:host:${host}`;
  
  try {
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ host }, 'Tenant cache hit');
      return JSON.parse(cached);
    }
    
    // Cache miss - query database
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT t.id, t.tenant_id, t.name, t.custom_domain, t.status
       FROM platform.tenants t
       INNER JOIN platform.domain_mapping dm ON t.tenant_id = dm.tenant_id
       WHERE dm.domain = $1 AND dm.verified = true AND t.status = 'active'`,
      [host]
    );
    
    if (result.rows.length === 0) {
      logger.warn({ host }, 'Tenant not found for host');
      return null;
    }
    
    const tenant = result.rows[0] as Tenant;
    
    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(tenant));
    
    logger.info({ tenant_id: tenant.tenant_id, host }, 'Tenant resolved from database');
    
    return tenant;
  } catch (error) {
    logger.error({ error, host }, 'Error resolving tenant');
    throw error;
  }
};

/**
 * Invalidate tenant cache (call after domain changes)
 */
export const invalidateTenantCache = async (host: string): Promise<void> => {
  const redis = getRedisClient();
  const cacheKey = `tenant:host:${host}`;
  await redis.del(cacheKey);
  logger.info({ host }, 'Tenant cache invalidated');
};
