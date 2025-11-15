import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client, getRedisClient } from './index';
import { config } from '../config';
import { logger } from '../utils/logger';
import NodeCache from 'node-cache';

interface Theme {
  id: string;
  name: string;
  version: string;
  s3_key: string;
  settings?: any;
  templates?: Record<string, string>;
}

// In-memory cache for compiled templates
const memoryCache = new NodeCache({ 
  stdTTL: config.cache.themesCacheTTL,
  checkperiod: 600,
  useClones: false 
});

/**
 * Get theme for tenant
 * Caching strategy:
 * 1. In-memory cache (fastest)
 * 2. Redis cache (fast)
 * 3. Database + S3 (slow)
 */
export const getThemeForTenant = async (tenantId: string): Promise<Theme | null> => {
  const cacheKey = `theme:${tenantId}`;
  
  try {
    // Check memory cache
    const memCached = memoryCache.get<Theme>(cacheKey);
    if (memCached) {
      logger.debug({ tenant_id: tenantId }, 'Theme memory cache hit');
      return memCached;
    }
    
    // Check Redis cache
    const redis = getRedisClient();
    const redisCached = await redis.get(cacheKey);
    if (redisCached) {
      const theme = JSON.parse(redisCached) as Theme;
      memoryCache.set(cacheKey, theme);
      logger.debug({ tenant_id: tenantId }, 'Theme Redis cache hit');
      return theme;
    }
    
    // Load from database and S3
    const theme = await loadThemeFromStorage(tenantId);
    if (!theme) {
      return null;
    }
    
    // Cache in both layers
    memoryCache.set(cacheKey, theme);
    await redis.setex(cacheKey, config.cache.themesCacheTTL, JSON.stringify(theme));
    
    logger.info({ tenant_id: tenantId, theme_id: theme.id }, 'Theme loaded from storage');
    
    return theme;
  } catch (error) {
    logger.error({ error, tenant_id: tenantId }, 'Error loading theme');
    throw error;
  }
};

/**
 * Load theme from database and fetch templates from S3
 */
const loadThemeFromStorage = async (tenantId: string): Promise<Theme | null> => {
  const { getDbPool } = await import('./index');
  const pool = getDbPool();
  
  // Get theme metadata from database
  const result = await pool.query(
    `SELECT id, name, version, s3_key, settings
     FROM tenant_${tenantId}.themes
     WHERE role = 'main'
     LIMIT 1`
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const themeData = result.rows[0];
  
  // Fetch template files from S3
  const templates = await fetchThemeTemplatesFromS3(themeData.s3_key);
  
  return {
    ...themeData,
    templates
  };
};

/**
 * Fetch theme templates from S3
 * Theme structure in S3:
 * themes/{tenant_id}/{theme_version}/
 *   - templates/
 *     - index.liquid
 *     - product.liquid
 *     - collection.liquid
 *     - page.liquid
 *   - assets/
 *     - style.css
 *     - script.js
 */
const fetchThemeTemplatesFromS3 = async (s3Key: string): Promise<Record<string, string>> => {
  const s3 = getS3Client();
  const templates: Record<string, string> = {};
  
  // List of template files to fetch
  const templateFiles = ['index', 'product', 'collection', 'page', 'cart', 'search'];
  
  for (const templateName of templateFiles) {
    try {
      const command = new GetObjectCommand({
        Bucket: config.s3.bucketName,
        Key: `${s3Key}/templates/${templateName}.liquid`
      });
      
      const response = await s3.send(command);
      const body = await response.Body?.transformToString();
      
      if (body) {
        templates[templateName] = body;
      }
    } catch (error: any) {
      // Template might not exist, that's ok
      if (error.name !== 'NoSuchKey') {
        logger.warn({ s3_key: s3Key, template: templateName, error }, 'Error fetching template');
      }
    }
  }
  
  return templates;
};

/**
 * Invalidate theme cache (call after theme update)
 */
export const invalidateThemeCache = async (tenantId: string): Promise<void> => {
  const cacheKey = `theme:${tenantId}`;
  
  // Clear memory cache
  memoryCache.del(cacheKey);
  
  // Clear Redis cache
  const redis = getRedisClient();
  await redis.del(cacheKey);
  
  logger.info({ tenant_id: tenantId }, 'Theme cache invalidated');
};

/**
 * Purge CDN cache for tenant (Cloudflare)
 */
export const purgeCDNCache = async (tenantId: string, paths?: string[]): Promise<void> => {
  if (!config.cloudflare.enabled) {
    logger.debug('Cloudflare CDN purge skipped (not enabled)');
    return;
  }
  
  try {
    // Purge by surrogate key
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.cloudflare.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tags: [`tenant_${tenantId}`]
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${response.statusText}`);
    }
    
    logger.info({ tenant_id: tenantId }, 'CDN cache purged successfully');
  } catch (error) {
    logger.error({ error, tenant_id: tenantId }, 'Error purging CDN cache');
    // Don't throw - cache purge failure shouldn't break the app
  }
};
