import { Request, Response, NextFunction } from 'express';

export const setCacheHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Public, cacheable for 1 hour
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  
  // Allow Cloudflare to cache
  res.setHeader('CDN-Cache-Control', 'max-age=3600');
  
  // Vary header for different versions
  res.setHeader('Vary', 'Accept-Encoding');
  
  next();
};

export const setNoCacheHeaders = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Expires', '0');
  res.setHeader('Pragma', 'no-cache');
  
  next();
};
