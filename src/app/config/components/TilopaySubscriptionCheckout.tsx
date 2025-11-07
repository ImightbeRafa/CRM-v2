'use client';

import { useEffect, useState, useRef } from 'react';
import Script from 'next/script';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Loader2, CreditCard, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

/**
 * Tilopay SDK v2 Subscription Checkout Component
 * Implements recurring monthly subscriptions with card tokenization
 * 
 * Key Features:
 * - SDK v2 (jQuery-free, modern implementation)
 * - Secure card tokenization
 * - Recurring payment support
 * - PCI DSS compliant (card data never touches our server)
 * - 3DS 2.0 support for security
 */

declare global {
  interface Window {
    TilopaySDK: any;
  }
}

interface TilopaySubscriptionCheckoutProps {
  planId: string;
  planName: string;
  amount: number; // In USD
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

export default function TilopaySubscriptionCheckout({ 
  planId, 
  planName, 
  amount, 
  onSuccess, 
  onError,
  onClose 
}: TilopaySubscriptionCheckoutProps) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkInitialized, setSdkInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const cardFormRef = useRef<HTMLDivElement>(null);
  const tilopayInstanceRef = useRef<any>(null);

  // Convert USD to CRC (approximate rate - Tilopay will use exact rate)
  const amountCRC = Math.round(amount * 1000); // $1 ≈ ₡1000

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (tilopayInstanceRef.current) {
        try {
          tilopayInstanceRef.current.destroy();
        } catch (e) {
          console.warn('SDK cleanup warning:', e);
        }
      }
    };
  }, []);

  const initializeSDK = async () => {
    if (!window.TilopaySDK) {
      setError('Tilopay SDK no está disponible. Intente recargar la página.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log('🔐 Initializing Tilopay SDK v2 for subscription...');

      // Get SDK token from backend
      const response = await fetch('/api/tilopay/create-subscription-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          planId, 
          amount: amountCRC,
          currency: 'CRC',
          recurring: true 
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to initialize payment');
      }

      const data = await response.json();
      
      if (!data.token) {
        throw new Error('No token received from server');
      }

      console.log('✅ SDK token received');

      // Initialize SDK v2
      tilopayInstanceRef.current = new window.TilopaySDK({
        apiKey: process.env.NEXT_PUBLIC_TILOPAY_API_KEY,
        token: data.token,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'test',
        language: 'es',
        currency: 'CRC',
        amount: amountCRC,
        subscription: true, // Enable recurring payments
        capture: true // Immediate capture
      });

      // Mount card form
      if (cardFormRef.current) {
        tilopayInstanceRef.current.mountCardForm(cardFormRef.current);
        setSdkInitialized(true);
        console.log('✅ Card form mounted');
      }

    } catch (err: any) {
      console.error('❌ SDK initialization error:', err);
      const errorMessage = err.message || 'Error al inicializar el pago';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tilopayInstanceRef.current) {
      setError('SDK no inicializado. Intente nuevamente.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('💳 Creating payment token...');

      // Create token (SDK v2 handles card encryption)
      const tokenResponse = await tilopayInstanceRef.current.createToken();

      if (!tokenResponse || !tokenResponse.token) {
        throw new Error(tokenResponse?.error || 'Failed to create payment token');
      }

      console.log('✅ Payment token created');

      // Send token to backend to create subscription
      const subscriptionResponse = await fetch('/api/tilopay/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          planId,
          token: tokenResponse.token,
          amount: amountCRC
        })
      });

      if (!subscriptionResponse.ok) {
        const errorData = await subscriptionResponse.json();
        throw new Error(errorData.error || 'Failed to create subscription');
      }

      const subscriptionData = await subscriptionResponse.json();
      
      console.log('✅ Subscription created:', subscriptionData);

      // Handle 3DS if needed
      if (subscriptionData.requires3DS && subscriptionData.redirectUrl) {
        console.log('🔒 3DS verification required, redirecting...');
        window.location.href = subscriptionData.redirectUrl;
        return;
      }

      // Success!
      setSuccess(true);
      onSuccess?.();

    } catch (err: any) {
      console.error('❌ Payment error:', err);
      const errorMessage = err.message || 'Error al procesar el pago';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Load Tilopay SDK v2 */}
      <Script
        src="https://sdk.tilopay.com/v2/tilopay-sdk.js"
        strategy="afterInteractive"
        onLoad={() => {
          console.log('✅ Tilopay SDK v2 loaded');
          setSdkLoaded(true);
        }}
        onError={() => {
          setError('Error cargando SDK de Tilopay. Verifique su conexión.');
        }}
      />

      <Card className="w-full max-w-md mx-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-xl font-semibold">
                Suscripción {planName}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                ₡{amountCRC.toLocaleString()} / mes
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
                disabled={loading}
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Messages */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-green-700">
                ¡Suscripción activada exitosamente!
              </div>
            </div>
          )}

          {/* Initialize Button or Card Form */}
          {!sdkInitialized ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-700">
                  <strong>Suscripción Recurrente:</strong> Su tarjeta será cargada automáticamente cada mes.
                </div>
              </div>
              
              <Button
                onClick={initializeSDK}
                disabled={!sdkLoaded || loading}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cargando...
                  </>
                ) : !sdkLoaded ? (
                  'Cargando SDK...'
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Iniciar Pago Seguro
                  </>
                )}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Card form mounted here by SDK */}
              <div 
                ref={cardFormRef} 
                className="border rounded p-4 min-h-[200px] bg-gray-50"
              />

              <Button
                type="submit"
                disabled={loading || success}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Procesando Pago...
                  </>
                ) : success ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Pago Completado
                  </>
                ) : (
                  `Pagar ₡${amountCRC.toLocaleString()} / mes`
                )}
              </Button>

              <div className="text-xs text-gray-500 space-y-1 text-center">
                <p>🔒 Pago seguro procesado por Tilopay</p>
                <p>💳 Tarjeta guardada para cargos recurrentes mensuales</p>
                <p>🔄 Cancele en cualquier momento desde su panel</p>
              </div>
            </form>
          )}

          {/* Test Mode Info */}
          {process.env.NODE_ENV !== 'production' && (
            <div className="text-xs text-gray-500 border-t pt-3">
              <strong>Modo de Prueba:</strong> Use tarjeta 4111111111111111, venc. 12/25, CVV 123
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
