import { Router, Request, Response, NextFunction } from 'express';
import { Liquid } from 'liquidjs';
import { getTenantFromHost } from '../services/tenant-service';
import { getThemeForTenant } from '../services/theme-service';
import { getProductsFromService, getProductByHandle } from '../services/microservices';
import { renderPage } from '../services/renderer-service';
import { logger } from '../utils/logger';
import { setCacheHeaders } from '../middleware/cache-headers';

const router = Router();

// Initialize Liquid engine
const liquid = new Liquid({
  cache: true,
  strictFilters: true,
  strictVariables: false,
});

// Main storefront rendering endpoint
router.get('*', setCacheHeaders, async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  try {
    const host = req.hostname;
    const path = req.path;
    
    logger.info({ host, path }, 'Rendering storefront request');

    // Step 1: Resolve tenant from host
    const tenant = await getTenantFromHost(host);
    if (!tenant) {
      return res.status(404).send('Store not found');
    }

    // Step 2: Load theme for tenant
    const theme = await getThemeForTenant(tenant.tenant_id);
    if (!theme) {
      return res.status(500).send('Theme not configured');
    }

    // Step 3: Determine route and fetch data
    const routeData = await resolveRoute(path, tenant.tenant_id);
    
    // Step 4: Render template
    const html = await renderPage(liquid, theme, routeData, {
      tenant,
      request: {
        path,
        query: req.query,
      }
    });

    // Step 5: Set cache headers and return
    const renderTime = Date.now() - startTime;
    
    // Add custom headers
    res.setHeader('X-Tenant-ID', tenant.tenant_id);
    res.setHeader('X-Render-Time', `${renderTime}ms`);
    res.setHeader('X-Theme-Version', theme.version);
    
    // Set Surrogate-Key for Cloudflare cache purging
    res.setHeader('Surrogate-Key', `tenant_${tenant.tenant_id} page_${routeData.type}`);
    
    logger.info({ 
      tenant_id: tenant.tenant_id, 
      path, 
      render_time: renderTime 
    }, 'Storefront rendered successfully');

    res.send(html);

  } catch (error) {
    logger.error({ error, host: req.hostname, path: req.path }, 'Error rendering storefront');
    next(error);
  }
});

// Route resolver - determines what data to fetch based on path
const resolveRoute = async (path: string, tenantId: string) => {
  // Homepage
  if (path === '/' || path === '') {
    // Get featured products from microservice
    const result = await getProductsFromService(tenantId, { limit: 12 });
    
    return {
      type: 'home',
      template: 'index',
      data: {
        collections: [],
        featured_products: result.products
      }
    };
  }

  // Product page: /products/:handle
  const productMatch = path.match(/^\/products\/([a-z0-9-]+)$/);
  if (productMatch) {
    const handle = productMatch[1];
    const product = await getProductByHandle(tenantId, handle);
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    return {
      type: 'product',
      template: 'product',
      data: {
        product
      }
    };
  }

  // Collection page: /collections/:handle
  const collectionMatch = path.match(/^\/collections\/([a-z0-9-]+)$/);
  if (collectionMatch) {
    const handle = collectionMatch[1];
    
    // Get products from microservice
    const result = await getProductsFromService(tenantId, { limit: 24 });
    
    return {
      type: 'collection',
      template: 'collection',
      data: {
        collection: {
          id: handle,
          title: handle.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          handle,
          description: '',
          published: true
        },
        products: result.products
      }
    };
  }

  // Static pages: /pages/:handle
  const pageMatch = path.match(/^\/pages\/([a-z0-9-]+)$/);
  if (pageMatch) {
    const handle = pageMatch[1];
    // TODO: Fetch page content from page-service
    
    return {
      type: 'page',
      template: 'page',
      data: {
        page: {
          title: handle,
          content: '<p>Page content here</p>'
        }
      }
    };
  }

  // 404
  throw new Error('Page not found');
};

export { router as storefrontRouter };
