import { Pool } from 'pg';
import Redis from 'ioredis';
import { S3Client } from '@aws-sdk/client-s3';
import { config } from './config';
import { logger } from './utils/logger';

let dbPool: Pool;
let redisClient: Redis;
let s3Client: S3Client;

export const initializeServices = async () => {
  // Initialize PostgreSQL connection pool
  dbPool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: config.database.maxConnections,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test database connection
  try {
    const client = await dbPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection established');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to database');
    throw error;
  }

  // Initialize Redis
  redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    keyPrefix: config.redis.keyPrefix,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  redisClient.on('error', (err) => {
    logger.error({ error: err }, 'Redis connection error');
  });

  redisClient.on('connect', () => {
    logger.info('Redis connection established');
  });

  // Initialize S3 client
  s3Client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    forcePathStyle: config.s3.forcePathStyle,
  });

  logger.info('S3 client initialized');
};

export const getDbPool = () => {
  if (!dbPool) {
    throw new Error('Database pool not initialized');
  }
  return dbPool;
};

export const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

export const getS3Client = () => {
  if (!s3Client) {
    throw new Error('S3 client not initialized');
  }
  return s3Client;
};

export { dbPool, redisClient, s3Client };
