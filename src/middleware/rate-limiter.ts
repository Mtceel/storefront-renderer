import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../services';
import { config } from '../config';
import { logger } from '../utils/logger';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const redis = getRedisClient();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rate_limit:${ip}`;
    
    const windowMs = config.security.rateLimitWindowMs;
    const maxRequests = config.security.rateLimitMaxRequests;
    
    // Get current count
    const current = await redis.get(key);
    const count = current ? parseInt(current, 10) : 0;
    
    if (count >= maxRequests) {
      const ttl = await redis.ttl(key);
      const resetTime = Date.now() + (ttl * 1000);
      
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', resetTime.toString());
      
      logger.warn({ ip, count }, 'Rate limit exceeded');
      
      return res.status(429).json({
        error: 'Too Many Requests',
        retryAfter: ttl
      });
    }
    
    // Increment count
    const newCount = await redis.incr(key);
    
    // Set expiry on first request
    if (newCount === 1) {
      await redis.pexpire(key, windowMs);
    }
    
    // Set headers
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (maxRequests - newCount).toString());
    
    next();
  } catch (error) {
    // If Redis fails, allow the request to proceed
    logger.error({ error }, 'Rate limiter error');
    next();
  }
};
