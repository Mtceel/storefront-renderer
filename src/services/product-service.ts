import { getDbPool, getRedisClient } from './index';
import { logger } from '../utils/logger';
import { config } from '../config';

interface Product {
  id: string;
  title: string;
  description?: string;
  handle: string;
  vendor?: string;
  product_type?: string;
  status: string;
  tags?: string[];
  published_at?: Date;
  variants?: ProductVariant[];
  images?: string[];
}

interface ProductVariant {
  id: string;
  product_id: string;
  title: string;
  sku?: string;
  price: number;
  compare_at_price?: number;
  inventory_quantity: number;
}

interface Collection {
  id: string;
  title: string;
  handle: string;
  description?: string;
  published: boolean;
  product_count?: number;
}

interface ProductQueryOptions {
  handle?: string;
  collection_id?: string;
  featured?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Fetch products with caching
 */
export const getProducts = async (
  tenantId: string,
  options: ProductQueryOptions = {}
): Promise<Product[]> => {
  const { handle, collection_id, featured, limit = 20, offset = 0 } = options;
  
  // Generate cache key based on options
  const cacheKey = `products:${tenantId}:${JSON.stringify(options)}`;
  
  try {
    // Check cache
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ tenant_id: tenantId, options }, 'Products cache hit');
      return JSON.parse(cached);
    }
    
    // Build query
    let query = `
      SELECT p.*, 
             json_agg(
               json_build_object(
                 'id', pv.id,
                 'title', pv.title,
                 'sku', pv.sku,
                 'price', pv.price,
                 'compare_at_price', pv.compare_at_price,
                 'inventory_quantity', pv.inventory_quantity
               )
             ) as variants
      FROM tenant_${tenantId}.products p
      LEFT JOIN tenant_${tenantId}.product_variants pv ON p.id = pv.product_id
      WHERE p.status = 'active'
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (handle) {
      query += ` AND p.handle = $${paramIndex}`;
      params.push(handle);
      paramIndex++;
    }
    
    if (collection_id) {
      query += ` AND p.id IN (
        SELECT product_id FROM tenant_${tenantId}.collection_products
        WHERE collection_id = $${paramIndex}
      )`;
      params.push(collection_id);
      paramIndex++;
    }
    
    query += ` GROUP BY p.id ORDER BY p.created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const pool = getDbPool();
    const result = await pool.query(query, params);
    
    const products = result.rows as Product[];
    
    // Cache for 5 minutes
    await redis.setex(cacheKey, config.cache.dataCacheTTL, JSON.stringify(products));
    
    logger.debug({ tenant_id: tenantId, count: products.length }, 'Products fetched from database');
    
    return products;
  } catch (error) {
    logger.error({ error, tenant_id: tenantId, options }, 'Error fetching products');
    throw error;
  }
};

/**
 * Fetch collections with caching
 */
export const getCollections = async (
  tenantId: string,
  options: { handle?: string; limit?: number; offset?: number } = {}
): Promise<Collection[]> => {
  const { handle, limit = 20, offset = 0 } = options;
  
  const cacheKey = `collections:${tenantId}:${JSON.stringify(options)}`;
  
  try {
    // Check cache
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ tenant_id: tenantId, options }, 'Collections cache hit');
      return JSON.parse(cached);
    }
    
    // Build query
    let query = `
      SELECT c.*,
             (SELECT COUNT(*) FROM tenant_${tenantId}.collection_products cp 
              WHERE cp.collection_id = c.id) as product_count
      FROM tenant_${tenantId}.collections c
      WHERE c.published = true
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (handle) {
      query += ` AND c.handle = $${paramIndex}`;
      params.push(handle);
      paramIndex++;
    }
    
    query += ` ORDER BY c.created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const pool = getDbPool();
    const result = await pool.query(query, params);
    
    const collections = result.rows as Collection[];
    
    // Cache for 5 minutes
    await redis.setex(cacheKey, config.cache.dataCacheTTL, JSON.stringify(collections));
    
    logger.debug({ tenant_id: tenantId, count: collections.length }, 'Collections fetched from database');
    
    return collections;
  } catch (error) {
    logger.error({ error, tenant_id: tenantId, options }, 'Error fetching collections');
    throw error;
  }
};

/**
 * Invalidate product/collection caches
 */
export const invalidateProductCache = async (tenantId: string): Promise<void> => {
  const redis = getRedisClient();
  
  // Delete all product and collection cache keys for this tenant
  const pattern = `${config.redis.keyPrefix}products:${tenantId}:*`;
  const keys = await redis.keys(pattern);
  
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  
  const collectionPattern = `${config.redis.keyPrefix}collections:${tenantId}:*`;
  const collectionKeys = await redis.keys(collectionPattern);
  
  if (collectionKeys.length > 0) {
    await redis.del(...collectionKeys);
  }
  
  logger.info({ tenant_id: tenantId }, 'Product caches invalidated');
};
