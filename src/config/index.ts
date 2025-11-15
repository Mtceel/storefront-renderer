import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.number().default(3000),
  version: z.string().default('1.0.0'),
  
  // PostgreSQL
  database: z.object({
    host: z.string(),
    port: z.number().default(5432),
    user: z.string(),
    password: z.string(),
    database: z.string(),
    maxConnections: z.number().default(20),
    ssl: z.boolean().default(false)
  }),
  
  // Redis
  redis: z.object({
    host: z.string(),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
    keyPrefix: z.string().default('renderer:'),
    ttl: z.number().default(3600) // 1 hour default
  }),
  
  // S3 / MinIO
  s3: z.object({
    endpoint: z.string().optional(),
    region: z.string().default('eu-west-1'),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    bucketName: z.string().default('themes'),
    forcePathStyle: z.boolean().default(false)
  }),
  
  // Cloudflare
  cloudflare: z.object({
    zoneId: z.string().optional(),
    apiToken: z.string().optional(),
    enabled: z.boolean().default(false)
  }),
  
  // Services URLs
  services: z.object({
    tenantService: z.string().default('http://tenant-service:8080'),
    productService: z.string().default('http://product-service:8080'),
    customerService: z.string().default('http://customer-service:8080'),
    inventoryService: z.string().default('http://inventory-service:8080')
  }),
  
  // Caching
  cache: z.object({
    enableRedis: z.boolean().default(true),
    enableMemory: z.boolean().default(true),
    themesCacheTTL: z.number().default(3600),
    dataCacheTTL: z.number().default(300),
    maxMemoryCacheSize: z.number().default(100) // MB
  }),
  
  // Security
  security: z.object({
    trustProxy: z.boolean().default(false),
    rateLimitWindowMs: z.number().default(60000), // 1 minute
    rateLimitMaxRequests: z.number().default(100)
  }),
  
  // Observability
  observability: z.object({
    jaegerEndpoint: z.string().optional(),
    enableTracing: z.boolean().default(true),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info')
  })
});

const parseConfig = () => {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test',
    port: parseInt(process.env.PORT || '3000', 10),
    version: process.env.VERSION || '1.0.0',
    
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'saas_admin',
      password: process.env.DB_PASSWORD || 'local_dev_password',
      database: process.env.DB_NAME || 'saas_platform',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
      ssl: process.env.DB_SSL === 'true'
    },
    
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'renderer:',
      ttl: parseInt(process.env.REDIS_TTL || '3600', 10)
    },
    
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'eu-west-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minio_admin',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minio_admin_password',
      bucketName: process.env.S3_BUCKET_NAME || 'themes',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
    },
    
    cloudflare: {
      zoneId: process.env.CLOUDFLARE_ZONE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      enabled: process.env.CLOUDFLARE_ENABLED === 'true'
    },
    
    services: {
      tenantService: process.env.TENANT_SERVICE_URL || 'http://tenant-service:8080',
      productService: process.env.PRODUCT_SERVICE_URL || 'http://product-service:8080',
      customerService: process.env.CUSTOMER_SERVICE_URL || 'http://customer-service:8080',
      inventoryService: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:8080'
    },
    
    cache: {
      enableRedis: process.env.CACHE_ENABLE_REDIS !== 'false',
      enableMemory: process.env.CACHE_ENABLE_MEMORY !== 'false',
      themesCacheTTL: parseInt(process.env.CACHE_THEMES_TTL || '3600', 10),
      dataCacheTTL: parseInt(process.env.CACHE_DATA_TTL || '300', 10),
      maxMemoryCacheSize: parseInt(process.env.CACHE_MAX_MEMORY_SIZE || '100', 10)
    },
    
    security: {
      trustProxy: process.env.TRUST_PROXY === 'true',
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    },
    
    observability: {
      jaegerEndpoint: process.env.JAEGER_ENDPOINT,
      enableTracing: process.env.ENABLE_TRACING !== 'false',
      logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error'
    }
  };

  return configSchema.parse(rawConfig);
};

export const config = parseConfig();
export type Config = z.infer<typeof configSchema>;
