// Add to Cart Button Component

'use client';

import { useState } from 'react';
import { useCartStore } from '@/lib/cart-store';
import { ShoppingCartIcon } from '@heroicons/react/24/outline';

interface AddToCartButtonProps {
  product: {
    id: number;
    title: string;
    variants: Array<{
      id: number;
      title: string;
      price: number;
      inventory_qty: number;
      sku?: string;
    }>;
    images?: Array<{
      url: string;
      alt_text?: string;
    }>;
  };
}

export default function AddToCartButton({ product }: AddToCartButtonProps) {
  const [selectedVariant, setSelectedVariant] = useState(product.variants[0]);
  const [adding, setAdding] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  const handleAddToCart = async () => {
    setAdding(true);

    addItem({
      variantId: selectedVariant.id,
      productId: product.id,
      productTitle: product.title,
      variantTitle: selectedVariant.title,
      price: selectedVariant.price,
      image: product.images?.[0]?.url,
      sku: selectedVariant.sku,
    });

    // Show success feedback
    setTimeout(() => {
      setAdding(false);
    }, 500);
  };

  const isOutOfStock = selectedVariant.inventory_qty <= 0;

  return (
    <div className="space-y-4">
      {/* Variant Selector */}
      {product.variants.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select variant
          </label>
          <select
            value={selectedVariant.id}
            onChange={(e) => {
              const variant = product.variants.find(
                (v) => v.id === parseInt(e.target.value)
              );
              if (variant) setSelectedVariant(variant);
            }}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            {product.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.title} - €{variant.price.toFixed(2)}
                {variant.inventory_qty <= 0 && ' (Out of stock)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Price */}
      <div className="text-2xl font-bold text-gray-900">
        €{selectedVariant.price.toFixed(2)}
      </div>

      {/* Stock Status */}
      {isOutOfStock ? (
        <div className="text-sm text-red-600">
          Out of stock
        </div>
      ) : selectedVariant.inventory_qty < 10 ? (
        <div className="text-sm text-yellow-600">
          Only {selectedVariant.inventory_qty} left in stock
        </div>
      ) : (
        <div className="text-sm text-green-600">
          In stock
        </div>
      )}

      {/* Add to Cart Button */}
      <button
        type="button"
        onClick={handleAddToCart}
        disabled={isOutOfStock || adding}
        className="w-full flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-8 py-3 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ShoppingCartIcon className="h-5 w-5 mr-2" />
        {adding ? 'Adding...' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
      </button>
    </div>
  );
}
