/**
 * Microservices Client
 * Connects storefront to backend microservices
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { getRedisClient } from './index';
import { config } from '../config';

// Service URLs (Kubernetes internal DNS)
const SERVICES = {
  products: 'http://products-service.platform-services.svc.cluster.local',
  checkout: 'http://checkout-service.platform-services.svc.cluster.local',
  orders: 'http://orders-service.platform-services.svc.cluster.local',
  customers: 'http://customers-service.platform-services.svc.cluster.local',
  discounts: 'http://discounts-service.platform-services.svc.cluster.local',
  analytics: 'http://analytics-service.platform-services.svc.cluster.local',
};

interface Product {
  id: string;
  tenant_id: string;
  title: string;
  handle: string;
  description?: string;
  price: number;
  compare_at_price?: number;
  sku?: string;
  inventory_qty: number;
  status: string;
  images?: string[];
  tags?: string[];
  created_at: string;
}

interface CartItem {
  product_id: string;
  quantity: number;
  price: number;
}

interface CheckoutData {
  tenant_id: string;
  items: CartItem[];
  customer_email: string;
  shipping_address: any;
  billing_address: any;
  discount_code?: string;
}

/**
 * Get products from products-service with caching
 */
export const getProductsFromService = async (
  tenantId: string,
  options: { handle?: string; limit?: number; offset?: number; search?: string } = {}
): Promise<{ products: Product[]; total: number }> => {
  const cacheKey = `storefront:products:${tenantId}:${JSON.stringify(options)}`;
  
  try {
    // Check cache
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ tenant_id: tenantId, options }, 'Storefront products cache hit');
      return JSON.parse(cached);
    }
    
    // Build query params
    const params = new URLSearchParams({
      tenant_id: tenantId,
      status: 'active', // Only show active products on storefront
      limit: String(options.limit || 20),
      offset: String(options.offset || 0),
    });
    
    if (options.handle) {
      params.append('handle', options.handle);
    }
    if (options.search) {
      params.append('search', options.search);
    }
    
    // Call products-service
    const response = await axios.get(
      `${SERVICES.products}/api/products?${params}`,
      { timeout: 5000 }
    );
    
    const data = response.data;
    
    // Cache for 2 minutes (shorter TTL for storefront)
    await redis.setex(cacheKey, 120, JSON.stringify(data));
    
    logger.info({ 
      tenant_id: tenantId, 
      count: data.products?.length || 0,
      service: 'products-service'
    }, 'Products fetched from microservice');
    
    return data;
  } catch (error: any) {
    logger.error({ 
      error: error.message, 
      tenant_id: tenantId, 
      options,
      service: 'products-service'
    }, 'Error fetching products from microservice');
    
    // Return empty array on error
    return { products: [], total: 0 };
  }
};

/**
 * Get single product by handle
 */
export const getProductByHandle = async (
  tenantId: string,
  handle: string
): Promise<Product | null> => {
  const cacheKey = `storefront:product:${tenantId}:${handle}`;
  
  try {
    // Check cache
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Get products with this handle
    const result = await getProductsFromService(tenantId, { handle, limit: 1 });
    const product = result.products[0] || null;
    
    if (product) {
      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(product));
    }
    
    return product;
  } catch (error) {
    logger.error({ error, tenant_id: tenantId, handle }, 'Error fetching product by handle');
    return null;
  }
};

/**
 * Create checkout session
 */
export const createCheckout = async (
  checkoutData: CheckoutData
): Promise<{ checkout_url: string; order_id: string } | null> => {
  try {
    const response = await axios.post(
      `${SERVICES.checkout}/api/checkout`,
      checkoutData,
      { timeout: 10000 }
    );
    
    logger.info({ 
      tenant_id: checkoutData.tenant_id,
      items_count: checkoutData.items.length 
    }, 'Checkout created');
    
    return response.data;
  } catch (error: any) {
    logger.error({ 
      error: error.message, 
      tenant_id: checkoutData.tenant_id 
    }, 'Error creating checkout');
    return null;
  }
};

/**
 * Validate discount code
 */
export const validateDiscountCode = async (
  tenantId: string,
  code: string,
  orderTotal: number
): Promise<{ valid: boolean; discount?: any; error?: string }> => {
  try {
    const response = await axios.get(
      `${SERVICES.discounts}/api/discounts/validate/${code}`,
      { 
        params: { tenant_id: tenantId },
        timeout: 3000 
      }
    );
    
    const discount = response.data.discount;
    
    // Check minimum purchase
    if (discount.minimum_purchase && orderTotal < discount.minimum_purchase) {
      return {
        valid: false,
        error: `Minimum purchase of $${discount.minimum_purchase} required`
      };
    }
    
    logger.info({ 
      tenant_id: tenantId, 
      code, 
      discount_type: discount.type,
      discount_value: discount.value
    }, 'Discount code validated');
    
    return { valid: true, discount };
  } catch (error: any) {
    const status = error.response?.status;
    
    if (status === 404) {
      return { valid: false, error: 'Invalid discount code' };
    } else if (status === 410) {
      return { valid: false, error: 'Discount code expired or limit reached' };
    }
    
    logger.error({ error: error.message, tenant_id: tenantId, code }, 'Error validating discount');
    return { valid: false, error: 'Unable to validate discount code' };
  }
};

/**
 * Calculate discount amount
 */
export const calculateDiscount = (
  discount: any,
  subtotal: number
): number => {
  if (discount.type === 'percentage') {
    return (subtotal * discount.value) / 100;
  } else if (discount.type === 'fixed') {
    return Math.min(discount.value, subtotal); // Don't exceed subtotal
  }
  return 0;
};

/**
 * Track analytics event (fire and forget)
 */
export const trackEvent = async (
  tenantId: string,
  event: string,
  data: any
): Promise<void> => {
  try {
    // Fire and forget - don't wait for response
    axios.post(
      `${SERVICES.analytics}/api/analytics/track`,
      { tenant_id: tenantId, event, data },
      { timeout: 1000 }
    ).catch(() => {
      // Ignore errors
    });
  } catch (error) {
    // Ignore errors - analytics shouldn't break the app
  }
};

export default {
  getProductsFromService,
  getProductByHandle,
  createCheckout,
  validateDiscountCode,
  calculateDiscount,
  trackEvent,
};
