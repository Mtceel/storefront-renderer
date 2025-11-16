// Storefront Renderer - Multi-tenant Liquid template engine
const express = require('express');
const { Liquid } = require('liquidjs');
const { Pool } = require('pg');
const Redis = require('ioredis');
let cors;
try {
  cors = require('cors');
} catch (e) {
  console.log('cors module not found, skipping CORS middleware');
}
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const liquid = new Liquid();

// PostgreSQL connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://saasuser:saaspass123@postgres.platform-services.svc.cluster.local:5432/saasplatform'
});

// Redis connection
const redisClient = new Redis(process.env.REDIS_URL || 'redis://redis.platform-services.svc.cluster.local:6379');

// Middleware
app.use(helmet());
app.use(compression());
if (cors) {
  app.use(cors());
}
app.use(express.json());

// Resolve tenant from hostname
async function resolveTenant(hostname) {
  const cacheKey = `tenant:${hostname}`;
  
  // Try cache
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Query database
  const result = await db.query(
    'SELECT id, subdomain, custom_domain, name FROM tenants WHERE subdomain = $1 OR custom_domain = $1 LIMIT 1',
    [hostname]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const tenant = result.rows[0];
  
  // Cache for 5 minutes
  await redisClient.setEx(cacheKey, 300, JSON.stringify(tenant));
  
  return tenant;
}

// Load products for tenant
async function loadProducts(tenantId) {
  const cacheKey = `products:${tenantId}`;
  
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  const result = await db.query(
    'SELECT id, handle, title, description, status FROM products WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC',
    [tenantId, 'active']
  );
  
  const products = result.rows;
  
  // Cache for 1 minute
  await redisClient.setEx(cacheKey, 60, JSON.stringify(products));
  
  return products;
}

// Default storefront template
const defaultTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ store.name }}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { background: #4f46e5; color: white; padding: 20px 0; margin-bottom: 40px; }
    h1 { font-size: 2.5rem; }
    .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 30px; }
    .product-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; transition: transform 0.2s; }
    .product-card:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.1); }
    .product-title { font-size: 1.25rem; margin-bottom: 10px; color: #1f2937; }
    .product-description { color: #6b7280; margin-bottom: 15px; }
    .btn { display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; }
    .btn:hover { background: #4338ca; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>{{ store.name }}</h1>
      <p>Welcome to our store!</p>
    </div>
  </header>
  
  <div class="container">
    <h2>Our Products</h2>
    <div class="products">
      {% for product in products %}
      <div class="product-card">
        <h3 class="product-title">{{ product.title }}</h3>
        <p class="product-description">{{ product.description }}</p>
        <a href="/products/{{ product.handle }}" class="btn">View Details</a>
      </div>
      {% endfor %}
    </div>
  </div>
</body>
</html>
`;

// Main route - render storefront
app.get('/', async (req, res) => {
  try {
    // Extract hostname (remove port)
    const hostname = req.hostname.split(':')[0];
    
    // Resolve tenant
    const tenant = await resolveTenant(hostname);
    if (!tenant) {
      return res.status(404).send('Store not found');
    }
    
    // Check if tenant has a custom "home" page
    const homePageResult = await db.query(
      'SELECT id, title, slug, content FROM pages WHERE tenant_id = $1 AND slug = $2 AND is_published = true',
      [tenant.id, 'home']
    );
    
    // If custom home page exists, render it
    if (homePageResult.rows.length > 0) {
      const page = homePageResult.rows[0];
      let blocks = [];
      
      try {
        blocks = JSON.parse(page.content || '[]');
      } catch (e) {
        console.error('Error parsing page content:', e);
      }
      
      // Render blocks to HTML
      const blocksHtml = blocks.map(block => renderBlock(block)).join('');
      
      const pageTemplate = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${tenant.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          img { max-width: 100%; height: auto; }
          a { color: #4f46e5; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        ${blocksHtml}
      </body>
      </html>
      `;
      
      return res.setHeader('Content-Type', 'text/html').send(pageTemplate);
    }
    
    // Otherwise, render default product listing page
    const products = await loadProducts(tenant.id);
    
    // Render with Liquid
    const html = await liquid.parseAndRender(defaultTemplate, {
      store: {
        name: tenant.name,
        subdomain: tenant.subdomain
      },
      products: products
    });
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(html);
    
  } catch (error) {
    console.error('Rendering error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Product detail page
app.get('/products/:handle', async (req, res) => {
  try {
    const hostname = req.hostname.split(':')[0];
    const tenant = await resolveTenant(hostname);
    
    if (!tenant) {
      return res.status(404).send('Store not found');
    }
    
    // Load product
    const result = await db.query(
      'SELECT id, handle, title, description FROM products WHERE tenant_id = $1 AND handle = $2 AND status = $3',
      [tenant.id, req.params.handle, 'active']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send('Product not found');
    }
    
    const product = result.rows[0];
    
    const productTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>{{ product.title }} - {{ store.name }}</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
        h1 { color: #333; }
        .price { font-size: 2rem; color: #4f46e5; margin: 20px 0; }
        .btn { background: #4f46e5; color: white; padding: 15px 30px; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>{{ product.title }}</h1>
      <p>{{ product.description }}</p>
      <div class="price">€29.99</div>
      <button class="btn">Add to Cart</button>
      <br><br>
      <a href="/">← Back to Store</a>
    </body>
    </html>
    `;
    
    const html = await liquid.parseAndRender(productTemplate, {
      store: { name: tenant.name },
      product: product
    });
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Custom page route (before health check)
app.get('/pages/:slug', async (req, res) => {
  try {
    const hostname = req.hostname.split(':')[0];
    const tenant = await resolveTenant(hostname);
    
    if (!tenant) {
      return res.status(404).send('Store not found');
    }
    
    // Load page from database
    const result = await db.query(
      'SELECT id, title, slug, content, is_published FROM pages WHERE tenant_id = $1 AND slug = $2 AND is_published = true',
      [tenant.id, req.params.slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Page Not Found - ${tenant.name}</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 100px auto; text-align: center; }
            h1 { color: #d72c0d; }
            a { color: #4f46e5; text-decoration: none; }
          </style>
        </head>
        <body>
          <h1>404 - Page Not Found</h1>
          <p>The page "${req.params.slug}" does not exist.</p>
          <a href="/">← Back to Home</a>
        </body>
        </html>
      `);
    }
    
    const page = result.rows[0];
    let blocks = [];
    
    try {
      blocks = JSON.parse(page.content || '[]');
    } catch (e) {
      console.error('Error parsing page content:', e);
    }
    
    // Render blocks to HTML
    const blocksHtml = blocks.map(block => renderBlock(block)).join('');
    
    const pageTemplate = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${page.title} - ${tenant.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        img { max-width: 100%; height: auto; }
        a { color: #4f46e5; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      ${blocksHtml}
    </body>
    </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(pageTemplate);
    
  } catch (error) {
    console.error('Page rendering error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Render a single block to HTML
function renderBlock(block) {
  const c = block.config || {};
  
  switch (block.type) {
    case 'hero':
      return `
        <div style="
          height: ${c.height || '600px'};
          background-image: ${c.backgroundImage ? `url('${c.backgroundImage}')` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
          background-size: cover;
          background-position: center;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${c.textColor || '#fff'};
          text-align: center;
          padding: 40px;
        ">
          <div>
            <h1 style="font-size: 3rem; margin-bottom: 1rem;">${c.title || 'Hero Title'}</h1>
            <p style="font-size: 1.5rem; margin-bottom: 2rem;">${c.subtitle || 'Subtitle'}</p>
            <a href="${c.buttonLink || '#'}" style="
              background: ${c.buttonColor || '#667eea'};
              color: white;
              padding: 15px 40px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              display: inline-block;
            ">${c.buttonText || 'Click Here'}</a>
          </div>
        </div>
      `;
    
    case 'text':
      return `
        <div style="max-width: ${c.maxWidth || '800px'}; margin: 40px auto; padding: 0 20px;">
          <h2 style="font-size: ${c.headingSize || '2rem'}; color: ${c.headingColor || '#333'}; margin-bottom: 1rem;">
            ${c.heading || 'Heading'}
          </h2>
          <div style="font-size: ${c.textSize || '1rem'}; color: ${c.textColor || '#666'}; line-height: 1.6;">
            ${c.content || '<p>Your content here...</p>'}
          </div>
        </div>
      `;
    
    case 'image':
      return `
        <div style="text-align: center; margin: 40px auto; max-width: ${c.maxWidth || '100%'};">
          <img src="${c.src || 'https://via.placeholder.com/800x600'}" alt="${c.alt || 'Image'}" style="border-radius: ${c.borderRadius || '0px'};" />
          ${c.caption ? `<p style="margin-top: 10px; color: #666; font-size: 0.9rem;">${c.caption}</p>` : ''}
        </div>
      `;
    
    case 'call-to-action':
      return `
        <div style="
          background: ${c.backgroundColor || '#667eea'};
          color: ${c.textColor || '#fff'};
          padding: 60px 40px;
          text-align: center;
          margin: 40px 0;
        ">
          <h2 style="font-size: 2.5rem; margin-bottom: 1rem;">${c.title || 'Ready to get started?'}</h2>
          <p style="font-size: 1.2rem; margin-bottom: 2rem;">${c.description || 'Description'}</p>
          <a href="${c.buttonLink || '#'}" style="
            background: ${c.buttonColor || '#fff'};
            color: ${c.textColor === '#fff' ? '#667eea' : '#fff'};
            padding: 15px 40px;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            display: inline-block;
          ">${c.buttonText || 'Get Started'}</a>
        </div>
      `;
    
    default:
      return `<div style="padding: 40px; text-align: center; background: #f5f5f5;">Block: ${block.type}</div>`;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'storefront-renderer',
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Storefront Renderer running on port ${PORT}`);
  console.log(`📦 Connected to PostgreSQL`);
  console.log(`🔴 Connected to Redis`);
});
