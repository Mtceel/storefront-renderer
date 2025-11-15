import { Liquid } from 'liquidjs';
import { logger } from '../utils/logger';

interface Theme {
  templates?: Record<string, string>;
  settings?: any;
}

interface RenderContext {
  tenant: any;
  request: {
    path: string;
    query: any;
  };
}

/**
 * Render a page using Liquid templates
 */
export const renderPage = async (
  liquid: Liquid,
  theme: Theme,
  routeData: any,
  context: RenderContext
): Promise<string> => {
  try {
    const templateName = routeData.template || 'index';
    const templateSource = theme.templates?.[templateName];
    
    if (!templateSource) {
      throw new Error(`Template ${templateName} not found`);
    }
    
    // Prepare template data
    const templateData = {
      // Route-specific data
      ...routeData.data,
      
      // Global context
      shop: {
        name: context.tenant.name,
        url: `https://${context.tenant.custom_domain || context.tenant.tenant_id + '.mystore.com'}`
      },
      
      // Request context
      request: context.request,
      
      // Theme settings
      settings: theme.settings || {},
      
      // Current page type
      template: templateName,
      
      // Helper filters and functions
      current_page: context.request.path,
      canonical_url: context.request.path
    };
    
    // Render the template
    const html = await liquid.parseAndRender(templateSource, templateData);
    
    // Wrap in layout if exists
    if (theme.templates?.layout) {
      const layoutHtml = await liquid.parseAndRender(theme.templates.layout, {
        ...templateData,
        content_for_layout: html
      });
      return layoutHtml;
    }
    
    return html;
  } catch (error) {
    logger.error({ error, template: routeData.template }, 'Error rendering page');
    throw error;
  }
};

/**
 * Register custom Liquid filters for Shopify-like functionality
 */
export const registerCustomFilters = (liquid: Liquid) => {
  // Money formatting
  liquid.registerFilter('money', (value: number) => {
    return `€${(value / 100).toFixed(2)}`;
  });
  
  // Money with currency
  liquid.registerFilter('money_with_currency', (value: number) => {
    return `€${(value / 100).toFixed(2)} EUR`;
  });
  
  // Image URL generation
  liquid.registerFilter('img_url', (src: string, size: string = 'medium') => {
    // In production, this would use a CDN
    const sizeMap: Record<string, string> = {
      'small': '100x100',
      'medium': '300x300',
      'large': '600x600',
      'original': 'original'
    };
    const dimensions = sizeMap[size] || sizeMap.medium;
    return `https://cdn.example.com/images/${dimensions}/${src}`;
  });
  
  // URL generation
  liquid.registerFilter('product_url', (handle: string) => {
    return `/products/${handle}`;
  });
  
  liquid.registerFilter('collection_url', (handle: string) => {
    return `/collections/${handle}`;
  });
  
  // Handle generation
  liquid.registerFilter('handleize', (str: string) => {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  });
  
  // Truncate with ellipsis
  liquid.registerFilter('truncate', (str: string, length: number = 50) => {
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
  });
};
