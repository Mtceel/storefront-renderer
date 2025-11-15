// Shopping Cart Service
// Manages cart state, add/remove items, calculate totals

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartItem {
  variantId: number;
  productId: number;
  productTitle: string;
  variantTitle: string;
  price: number;
  quantity: number;
  image?: string;
  sku?: string;
}

interface Cart {
  items: CartItem[];
  total: number;
  subtotal: number;
  tax: number;
  shipping: number;
}

interface CartStore extends Cart {
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (variantId: number) => void;
  updateQuantity: (variantId: number, quantity: number) => void;
  clearCart: () => void;
  calculateTotals: () => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      total: 0,
      subtotal: 0,
      tax: 0,
      shipping: 0,

      addItem: (item) => {
        const items = get().items;
        const existingItem = items.find((i) => i.variantId === item.variantId);

        if (existingItem) {
          // Increase quantity
          set({
            items: items.map((i) =>
              i.variantId === item.variantId
                ? { ...i, quantity: i.quantity + 1 }
                : i
            ),
          });
        } else {
          // Add new item
          set({
            items: [...items, { ...item, quantity: 1 }],
          });
        }

        get().calculateTotals();
      },

      removeItem: (variantId) => {
        set({
          items: get().items.filter((i) => i.variantId !== variantId),
        });
        get().calculateTotals();
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(variantId);
          return;
        }

        set({
          items: get().items.map((i) =>
            i.variantId === variantId ? { ...i, quantity } : i
          ),
        });
        get().calculateTotals();
      },

      clearCart: () => {
        set({
          items: [],
          total: 0,
          subtotal: 0,
          tax: 0,
          shipping: 0,
        });
      },

      calculateTotals: () => {
        const items = get().items;
        const subtotal = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );
        const tax = subtotal * 0.21; // 21% VAT (NL)
        const shipping = subtotal > 50 ? 0 : 5.95; // Free shipping > €50
        const total = subtotal + tax + shipping;

        set({ subtotal, tax, shipping, total });
      },
    }),
    {
      name: 'shopping-cart',
    }
  )
);
