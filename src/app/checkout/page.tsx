// Checkout Page - Multi-step checkout flow

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/lib/cart-store';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type CheckoutStep = 'shipping' | 'payment' | 'confirmation';

interface ShippingInfo {
  email: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone: string;
}

export default function CheckoutPage() {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutFlow />
    </Elements>
  );
}

function CheckoutFlow() {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  
  const { items, total, subtotal, tax, shipping, clearCart } = useCartStore();
  const [step, setStep] = useState<CheckoutStep>('shipping');
  const [shippingInfo, setShippingInfo] = useState<ShippingInfo>({
    email: '',
    firstName: '',
    lastName: '',
    address1: '',
    address2: '',
    city: '',
    province: '',
    postalCode: '',
    country: 'NL',
    phone: '',
  });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  // Redirect if cart is empty
  if (items.length === 0 && step !== 'confirmation') {
    router.push('/');
    return null;
  }

  const handleShippingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('payment');
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setProcessing(true);

    if (!stripe || !elements) {
      return;
    }

    try {
      // Create payment intent
      const response = await fetch('/api/checkout/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(total * 100), // Convert to cents
          currency: 'eur',
          shipping: shippingInfo,
          items: items.map((item) => ({
            product_id: item.productId,
            variant_id: item.variantId,
            quantity: item.quantity,
            price: item.price,
          })),
        }),
      });

      const { clientSecret, orderId } = await response.json();

      // Confirm payment
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: elements.getElement(CardElement)!,
            billing_details: {
              name: `${shippingInfo.firstName} ${shippingInfo.lastName}`,
              email: shippingInfo.email,
              phone: shippingInfo.phone,
              address: {
                line1: shippingInfo.address1,
                line2: shippingInfo.address2,
                city: shippingInfo.city,
                state: shippingInfo.province,
                postal_code: shippingInfo.postalCode,
                country: shippingInfo.country,
              },
            },
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (paymentIntent.status === 'succeeded') {
        // Clear cart
        clearCart();
        
        // Show confirmation
        setStep('confirmation');
        
        // Redirect to order page
        setTimeout(() => {
          router.push(`/orders/${orderId}`);
        }, 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Forms */}
          <div className="space-y-6">
            {/* Progress Indicator */}
            <nav aria-label="Progress">
              <ol className="flex items-center">
                <li className={`relative pr-8 ${step === 'shipping' ? 'text-indigo-600' : 'text-gray-900'}`}>
                  <div className="flex items-center">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${step === 'shipping' ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`}>
                      1
                    </div>
                    <span className="ml-4 text-sm font-medium">Shipping</span>
                  </div>
                </li>
                <li className={`relative pr-8 ${step === 'payment' ? 'text-indigo-600' : step === 'confirmation' ? 'text-gray-900' : 'text-gray-400'}`}>
                  <div className="flex items-center">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${step === 'payment' ? 'bg-indigo-600 text-white' : step === 'confirmation' ? 'bg-gray-200' : 'bg-gray-100'}`}>
                      2
                    </div>
                    <span className="ml-4 text-sm font-medium">Payment</span>
                  </div>
                </li>
                <li className={`relative ${step === 'confirmation' ? 'text-indigo-600' : 'text-gray-400'}`}>
                  <div className="flex items-center">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${step === 'confirmation' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                      3
                    </div>
                    <span className="ml-4 text-sm font-medium">Confirmation</span>
                  </div>
                </li>
              </ol>
            </nav>

            {/* Shipping Form */}
            {step === 'shipping' && (
              <form onSubmit={handleShippingSubmit} className="bg-white shadow-sm rounded-lg p-6 space-y-4">
                <h2 className="text-lg font-medium text-gray-900">Shipping Information</h2>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    required
                    value={shippingInfo.email}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, email: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">First name</label>
                    <input
                      type="text"
                      required
                      value={shippingInfo.firstName}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, firstName: e.target.value })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last name</label>
                    <input
                      type="text"
                      required
                      value={shippingInfo.lastName}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, lastName: e.target.value })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Address</label>
                  <input
                    type="text"
                    required
                    value={shippingInfo.address1}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, address1: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">City</label>
                    <input
                      type="text"
                      required
                      value={shippingInfo.city}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, city: e.target.value })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Postal code</label>
                    <input
                      type="text"
                      required
                      value={shippingInfo.postalCode}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, postalCode: e.target.value })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone</label>
                  <input
                    type="tel"
                    required
                    value={shippingInfo.phone}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, phone: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Continue to payment
                </button>
              </form>
            )}

            {/* Payment Form */}
            {step === 'payment' && (
              <form onSubmit={handlePaymentSubmit} className="bg-white shadow-sm rounded-lg p-6 space-y-4">
                <h2 className="text-lg font-medium text-gray-900">Payment Information</h2>
                
                {error && (
                  <div className="rounded-md bg-red-50 p-4">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <div className="p-4 border border-gray-300 rounded-md">
                  <CardElement
                    options={{
                      style: {
                        base: {
                          fontSize: '16px',
                          color: '#424770',
                          '::placeholder': {
                            color: '#aab7c4',
                          },
                        },
                        invalid: {
                          color: '#9e2146',
                        },
                      },
                    }}
                  />
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setStep('shipping')}
                    className="flex-1 py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={!stripe || processing}
                    className="flex-1 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {processing ? 'Processing...' : `Pay €${total.toFixed(2)}`}
                  </button>
                </div>
              </form>
            )}

            {/* Confirmation */}
            {step === 'confirmation' && (
              <div className="bg-white shadow-sm rounded-lg p-6 text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="mt-4 text-lg font-medium text-gray-900">Order confirmed!</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Thank you for your purchase. You'll receive a confirmation email shortly.
                </p>
              </div>
            )}
          </div>

          {/* Right Column - Order Summary */}
          <div className="bg-white shadow-sm rounded-lg p-6 h-fit">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Order Summary</h2>
            
            <ul className="divide-y divide-gray-200">
              {items.map((item) => (
                <li key={item.variantId} className="py-4 flex">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{item.productTitle}</h3>
                    <p className="text-sm text-gray-500">{item.variantTitle}</p>
                    <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    €{(item.price * item.quantity).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>

            <dl className="mt-6 space-y-2 border-t border-gray-200 pt-4">
              <div className="flex justify-between text-sm">
                <dt className="text-gray-600">Subtotal</dt>
                <dd className="font-medium text-gray-900">€{subtotal.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-gray-600">Shipping</dt>
                <dd className="font-medium text-gray-900">
                  {shipping === 0 ? 'FREE' : `€${shipping.toFixed(2)}`}
                </dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-gray-600">Tax (21%)</dt>
                <dd className="font-medium text-gray-900">€{tax.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between text-base font-medium border-t border-gray-200 pt-4">
                <dt>Total</dt>
                <dd>€{total.toFixed(2)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
