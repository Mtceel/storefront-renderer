const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'storefront-renderer' });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Demo Store</title></head>
    <body>
      <h1>Welcome to Demo Store</h1>
      <p>Multi-tenant storefront renderer operational</p>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Renderer running on', PORT));
