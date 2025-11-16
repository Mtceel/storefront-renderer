/**
 * Cart and Checkout Routes
 * Handles shopping cart and checkout operations
 */

import { Router, Request, Response } from 'express';
import { createCheckout, validateDiscountCode, calculateDiscount } from '../services/microservices';
import { getTenantFromHost } from '../services/tenant-service';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /cart/checkout
 * Create checkout session
 */
router.post('/cart/checkout', async (req: Request, res: Response) => {
  try {
    const host = req.hostname;
    const tenant = await getTenantFromHost(host);
    
    if (!tenant) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const { items, customer_email, shipping_address, billing_address, discount_code } = req.body;

    // Validate required fields
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    if (!customer_email) {
      return res.status(400).json({ error: 'Customer email is required' });
    }
    if (!shipping_address) {
      return res.status(400).json({ error: 'Shipping address is required' });
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.price * item.quantity);
    }, 0);

    // Validate discount code if provided
    let discount = null;
    let discountAmount = 0;
    
    if (discount_code) {
      const validation = await validateDiscountCode(tenant.tenant_id, discount_code, subtotal);
      
      if (validation.valid && validation.discount) {
        discount = validation.discount;
        discountAmount = calculateDiscount(discount, subtotal);
      } else {
        return res.status(400).json({ 
          error: validation.error || 'Invalid discount code' 
        });
      }
    }

    // Create checkout
    const checkoutData = {
      tenant_id: tenant.tenant_id,
      items,
      customer_email,
      shipping_address,
      billing_address: billing_address || shipping_address,
      discount_code: discount?.code,
    };

    const result = await createCheckout(checkoutData);

    if (!result) {
      return res.status(500).json({ error: 'Failed to create checkout' });
    }

    logger.info({ 
      tenant_id: tenant.tenant_id, 
      order_id: result.order_id,
      total: subtotal - discountAmount
    }, 'Checkout created successfully');

    res.json({
      success: true,
      checkout_url: result.checkout_url,
      order_id: result.order_id,
      subtotal,
      discount: discountAmount,
      total: subtotal - discountAmount
    });

  } catch (error: any) {
    logger.error({ error: error.message }, 'Error creating checkout');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /cart/validate-discount
 * Validate discount code
 */
router.post('/cart/validate-discount', async (req: Request, res: Response) => {
  try {
    const host = req.hostname;
    const tenant = await getTenantFromHost(host);
    
    if (!tenant) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const { code, subtotal } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Discount code is required' });
    }
    if (!subtotal || subtotal <= 0) {
      return res.status(400).json({ error: 'Invalid subtotal' });
    }

    const validation = await validateDiscountCode(tenant.tenant_id, code, subtotal);

    if (!validation.valid) {
      return res.status(400).json({ 
        valid: false,
        error: validation.error 
      });
    }

    const discountAmount = calculateDiscount(validation.discount, subtotal);

    res.json({
      valid: true,
      discount: validation.discount,
      discount_amount: discountAmount,
      total: subtotal - discountAmount
    });

  } catch (error: any) {
    logger.error({ error: error.message }, 'Error validating discount');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cart
 * Get cart page (static HTML or template)
 */
router.get('/cart', async (req: Request, res: Response) => {
  // Return simple cart page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shopping Cart</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .cart-item { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .checkout-btn { background: #2c6ecb; color: white; padding: 12px 24px; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
        .checkout-btn:hover { background: #1e5bb5; }
      </style>
    </head>
    <body>
      <h1>Shopping Cart</h1>
      <div id="cart-items"></div>
      <div id="cart-summary"></div>
      <button class="checkout-btn" onclick="checkout()">Proceed to Checkout</button>
      
      <script>
        // Cart management would be implemented here
        // This is a placeholder for now
        function checkout() {
          alert('Checkout functionality will be implemented');
        }
      </script>
    </body>
    </html>
  `);
});

export default router;
