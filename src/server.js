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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(compression());
if (cors) {
  app.use(cors());
}
app.use(express.json());

// Resolve tenant from hostname
async function resolveTenant(hostname) {
  // Extract subdomain from hostname (e.g., "finaltest" from "finaltest.fv-company.com")
  let subdomain = hostname;
  
  // If hostname is like subdomain.fv-company.com, extract just the subdomain
  if (hostname.endsWith('.fv-company.com')) {
    subdomain = hostname.replace('.fv-company.com', '');
  }
  
  const cacheKey = `tenant:${subdomain}`;
  
  // Try cache
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Query database - check both subdomain and custom_domain
  const result = await db.query(
    'SELECT id, subdomain, custom_domain, store_name as name FROM tenants WHERE subdomain = $1 OR custom_domain = $2 LIMIT 1',
    [subdomain, hostname]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const tenant = result.rows[0];
  
  // Cache for 5 minutes
  await redisClient.setex(cacheKey, 300, JSON.stringify(tenant));
  
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
  await redisClient.setex(cacheKey, 60, JSON.stringify(products));
  
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
      return res.status(404).send(renderStoreNotFound());
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
      return res.status(404).send(renderStoreNotFound());
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
      return res.status(404).send(renderStoreNotFound());
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

// POST /preview - Render blocks in real-time (Shopify-style)
app.post('/preview', express.json(), async (req, res) => {
  try {
    const { blocks, tenantId, editable } = req.body;
    
    if (!blocks || !Array.isArray(blocks)) {
      return res.status(400).json({ error: 'blocks array required' });
    }
    
    // Skip database query for preview - just render blocks
    const tenantName = 'Store Preview';
    
    // Render blocks to HTML with optional data-block-id for editing
    const blocksHtml = blocks.map(block => renderBlock(block, editable)).join('');
    
    const previewHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview - ${tenantName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
      line-height: 1.6; 
      color: #333; 
      background: #fff;
    }
    img { max-width: 100%; height: auto; display: block; }
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
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(previewHtml);
    
  } catch (error) {
    console.error('Preview rendering error:', error);
    res.status(500).json({ error: 'Preview rendering failed' });
  }
});

// Render a single block to HTML
function renderBlock(block, editable = false) {
  const c = block.config || {};
  const blockId = editable ? `data-block-id="${block.id}"` : '';
  const editableStyle = editable ? 'cursor: pointer; transition: opacity 0.2s;' : '';
  const editableHover = editable ? 'onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"' : '';
  
  switch (block.type) {
    case 'hero':
      const heroBackground = c.backgroundImage 
        ? `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url('${c.backgroundImage}')`
        : c.backgroundColor || '#4f46e5';
      
      return `
        <div ${blockId} ${editableHover} style="
          min-height: ${c.height || '500px'};
          background: ${heroBackground};
          background-size: cover;
          background-position: center;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 60px 20px;
          ${editableStyle}
        ">
          <div style="max-width: 800px;">
            <h1 style="
              font-size: clamp(2rem, 5vw, 3.5rem);
              margin-bottom: 1rem;
              color: ${c.titleColor || '#ffffff'};
              font-weight: 700;
              line-height: 1.2;
            ">${c.title || 'Welcome to our store'}</h1>
            ${c.subtitle ? `
              <p style="
                font-size: clamp(1rem, 3vw, 1.5rem);
                margin-bottom: 2rem;
                color: ${c.titleColor || '#ffffff'};
                opacity: 0.9;
              ">${c.subtitle}</p>
            ` : ''}
            ${c.buttonText ? `
              <a href="${c.buttonLink || '#'}" style="
                background: ${c.buttonColor || '#ffffff'};
                color: ${c.backgroundColor || '#4f46e5'};
                padding: 16px 40px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1.125rem;
                display: inline-block;
                transition: transform 0.2s;
              ">${c.buttonText}</a>
            ` : ''}
          </div>
        </div>
      `;
    
    case 'text':
      return `
        <div ${blockId} ${editableHover} style="
          max-width: 800px;
          margin: 60px auto;
          padding: 0 20px;
          background: ${c.backgroundColor || '#ffffff'};
          text-align: ${c.textAlign || 'left'};
          ${editableStyle}
        ">
          ${c.heading ? `
            <h2 style="
              font-size: 2.5rem;
              color: ${c.textColor || '#333333'};
              margin-bottom: 1.5rem;
              font-weight: 700;
            ">${c.heading}</h2>
          ` : ''}
          <div style="
            font-size: 1.125rem;
            color: ${c.textColor || '#333333'};
            line-height: 1.8;
            opacity: 0.9;
          ">
            ${c.content || '<p>Add your text here...</p>'}
          </div>
        </div>
      `;
    
    case 'image':
      const imageContent = c.link 
        ? `<a href="${c.link}" style="display: block;">
             <img src="${c.imageUrl || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=400&fit=crop'}" 
                  alt="${c.alt || 'Image'}" 
                  style="width: 100%; height: auto; border-radius: 8px; display: block;" />
           </a>`
        : `<img src="${c.imageUrl || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=400&fit=crop'}" 
                alt="${c.alt || 'Image'}" 
                style="width: 100%; height: auto; border-radius: 8px; display: block;" />`;
      
      return `
        <div ${blockId} ${editableHover} style="max-width: 1200px; margin: 60px auto; padding: 0 20px; ${editableStyle}">
          ${imageContent}
        </div>
      `;
    
    case 'products':
      // Load real products from database for this tenant
      const productLimit = c.limit || 4;
      let realProducts = [];
      
      try {
        const productResult = await pool.query(
          'SELECT id, name, description, price, image_url FROM products WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3',
          [tenantId, 'active', productLimit]
        );
        realProducts = productResult.rows;
      } catch (err) {
        console.error('Error loading products:', err);
      }
      
      // If no products found, show placeholder message
      if (realProducts.length === 0) {
        return `
          <div style="
            background: ${c.backgroundColor || '#f9fafb'};
            padding: 80px 20px;
          ">
            <div style="max-width: 1200px; margin: 0 auto; text-align: center;">
              ${c.heading ? `
                <h2 style="
                  font-size: 2.5rem;
                  margin-bottom: 2rem;
                  font-weight: 700;
                ">${c.heading}</h2>
              ` : ''}
              <p style="color: #666; font-size: 1.125rem;">No products available yet. Add products in your dashboard to display them here.</p>
            </div>
          </div>
        `;
      }
      
      const productsHtml = realProducts.map((product, i) => `
        <div ${i === 0 ? blockId : ''} style="
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          transition: transform 0.2s;
          ${i === 0 ? editableStyle : ''}
        " ${i === 0 ? editableHover : ''}>
          <img src="${product.image_url || 'https://picsum.photos/400/400'}" 
               alt="${product.name}" 
               style="width: 100%; height: 250px; object-fit: cover;" />
          <div style="padding: 20px;">
            <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; font-weight: 600;">${product.name}</h3>
            <p style="color: #666; margin-bottom: 1rem;">${product.description || 'Quality product'}</p>
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
            ">
              <span style="font-size: 1.5rem; font-weight: 700; color: #4f46e5;">$${parseFloat(product.price).toFixed(2)}</span>
              <button style="
                background: #4f46e5;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
              ">Add to Cart</button>
            </div>
          </div>
        </div>
      `).join('');
      
      return `
        <div style="
          background: ${c.backgroundColor || '#f9fafb'};
          padding: 80px 20px;
        ">
          <div style="max-width: 1200px; margin: 0 auto;">
            ${c.heading ? `
              <h2 style="
                text-align: center;
                font-size: 2.5rem;
                margin-bottom: 3rem;
                font-weight: 700;
              ">${c.heading}</h2>
            ` : ''}
            <div style="
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
              gap: 24px;
            ">
              ${productsHtml}
            </div>
          </div>
        </div>
      `;
    
    case 'video':
      let embedUrl = '';
      if (c.videoUrl) {
        if (c.videoUrl.includes('youtube.com') || c.videoUrl.includes('youtu.be')) {
          const videoId = c.videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
          embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : '';
        } else if (c.videoUrl.includes('vimeo.com')) {
          const videoId = c.videoUrl.match(/vimeo\.com\/(\d+)/)?.[1];
          embedUrl = videoId ? `https://player.vimeo.com/video/${videoId}` : '';
        }
      }
      
      return `
        <div style="max-width: 1000px; margin: 60px auto; padding: 0 20px;">
          ${c.heading ? `
            <h2 style="
              text-align: center;
              font-size: 2.5rem;
              margin-bottom: 2rem;
              font-weight: 700;
            ">${c.heading}</h2>
          ` : ''}
          ${embedUrl ? `
            <div style="
              position: relative;
              padding-bottom: 56.25%;
              height: 0;
              overflow: hidden;
              border-radius: 12px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            ">
              <iframe 
                src="${embedUrl}"
                style="
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                "
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
              ></iframe>
            </div>
          ` : `
            <div style="
              background: #f0f0f0;
              padding: 80px 20px;
              text-align: center;
              border-radius: 12px;
              border: 2px dashed #ccc;
            ">
              <p style="font-size: 1.25rem; color: #666;">🎥 Add a YouTube or Vimeo URL</p>
            </div>
          `}
        </div>
      `;
    
    case 'gallery':
      const galleryImages = Array.isArray(c.images) && c.images.length > 0 
        ? c.images 
        : ['https://via.placeholder.com/400x400', 'https://via.placeholder.com/400x400', 'https://via.placeholder.com/400x400'];
      
      return `
        <div style="max-width: 1200px; margin: 60px auto; padding: 0 20px;">
          <div style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
          ">
            ${galleryImages.map(img => `
              <div style="
                aspect-ratio: 1;
                overflow: hidden;
                border-radius: 8px;
              ">
                <img src="${img}" alt="Gallery image" style="
                  width: 100%;
                  height: 100%;
                  object-fit: cover;
                  transition: transform 0.3s;
                " />
              </div>
            `).join('')}
          </div>
        </div>
      `;
    
    default:
      return `
        <div style="
          padding: 60px 20px;
          text-align: center;
          background: #f5f5f5;
          border: 2px dashed #ccc;
          border-radius: 8px;
          margin: 20px;
        ">
          <p style="font-size: 1.25rem; color: #666;">📦 Block: ${block.type}</p>
        </div>
      `;
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

// Helper function for "Store not found" page
function renderStoreNotFound() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Store Not Found</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 600px;
          width: 100%;
          padding: 60px 40px;
          text-align: center;
        }
        .logo {
          font-size: 3rem;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 2.5rem;
          color: #333;
          margin-bottom: 20px;
          font-weight: 600;
        }
        p {
          font-size: 1.1rem;
          color: #666;
          line-height: 1.6;
          margin-bottom: 30px;
        }
        .buttons {
          display: flex;
          gap: 15px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .btn {
          padding: 14px 32px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.3s ease;
          display: inline-block;
        }
        .btn-primary {
          background: #667eea;
          color: white;
        }
        .btn-primary:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        .btn-secondary {
          background: #f3f4f6;
          color: #333;
        }
        .btn-secondary:hover {
          background: #e5e7eb;
        }
        .footer {
          margin-top: 40px;
          padding-top: 30px;
          border-top: 1px solid #e5e7eb;
          color: #999;
          font-size: 0.9rem;
        }
        .footer a {
          color: #667eea;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">🏪</div>
        <h1>Store Not Found</h1>
        <p>
          Sorry, we couldn't find this store. The store might have been moved, deleted, 
          or the URL might be incorrect.
        </p>
        <div class="buttons">
          <a href="https://fv-company.com" class="btn btn-primary">
            Go to FV-Company
          </a>
          <a href="https://fv-company.com/signup" class="btn btn-secondary">
            Create Your Store
          </a>
        </div>
        <div class="footer">
          Powered by <a href="https://fv-company.com">FV-Company</a> — 
          The easiest way to start your online store
        </div>
      </div>
    </body>
    </html>
  `;
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Storefront Renderer running on port ${PORT}`);
  console.log(`📦 Connected to PostgreSQL`);
  console.log(`🔴 Connected to Redis`);
});
// Trigger rebuild with /preview endpoint
