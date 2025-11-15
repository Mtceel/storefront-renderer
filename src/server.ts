import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import { register } from 'prom-client';
import { logger } from './utils/logger';
import { config } from './config';
import { initTracing } from './tracing';
import { storefrontRouter } from './routes/storefront';
import { healthRouter } from './routes/health';
import { initializeServices } from './services';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';

// Initialize OpenTelemetry tracing
initTracing();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow dynamic content from themes
  crossOriginEmbedderPolicy: false
}));

// Request logging
app.use(pinoHttp({ logger }));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting
app.use(rateLimiter);

// Health checks (no auth required)
app.use('/health', healthRouter);

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Storefront rendering (main functionality)
app.use('/', storefrontRouter);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close database connections, Redis, etc.
  try {
    await Promise.all([
      // Services will be closed here
    ]);
    logger.info('All connections closed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
};

// Initialize services and start server
const startServer = async () => {
  try {
    // Initialize all services (DB, Redis, S3)
    await initializeServices();
    logger.info('All services initialized');

    const server = app.listen(config.port, () => {
      logger.info({
        port: config.port,
        env: config.nodeEnv,
        version: config.version
      }, 'Storefront Renderer started');
    });

    // Graceful shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

const server = startServer();

export { app, server };
