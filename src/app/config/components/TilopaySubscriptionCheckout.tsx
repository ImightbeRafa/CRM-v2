'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Loader2, CreditCard, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

/**
 * Tilopay Hosted Subscription Checkout Component
 * Uses Tilopay Repeat API for recurring monthly subscriptions
 * 
 * Flow:
 * 1. Creates subscription plan via /api/tilopay/create-plan-repeat
 * 2. Redirects user to Tilopay-hosted payment form
 * 3. User enters card details on Tilopay's secure page
 * 4. Webhooks notify our system of subscription events
 * 5. Monthly recurring payments handled automatically by Tilopay
 */

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Convert USD to CRC (approximate rate - Tilopay will use exact rate)
  const amountCRC = Math.round(amount * 1000); // $1 ≈ ₡1000

  const handlePayment = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🌐 Starting hosted payment flow via Tilopay Repeat API...');
      console.log('📦 Plan details:', { planId, planName, amount: amountCRC });

      const response = await fetch('/api/tilopay/create-plan-repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          planId, 
          planName,
          amount: amountCRC,
          currency: 'CRC'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || 'Failed to create payment plan');
      }

      const data = await response.json();
      console.log('✅ Plan creation response:', data);

      if (data.paymentUrl) {
        console.log('🔗 Redirecting to payment URL:', data.paymentUrl);
        
        // Redirect to Tilopay hosted page
        window.location.href = data.paymentUrl;
      } else {
        throw new Error('No payment URL received from server. Response: ' + JSON.stringify(data));
      }

    } catch (err: any) {
      console.error('❌ Hosted payment error:', err);
      const errorMessage = err.message || 'Error al crear plan de pago';
      setError(errorMessage);
      onError?.(errorMessage);
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-xl font-semibold">
                Suscripción {planName}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                ₡{amountCRC.toLocaleString()} / mes
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-muted-foreground"
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

          {/* Info Banner */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <strong>Suscripción Recurrente:</strong> Su tarjeta será cargada automáticamente cada mes. Puede cancelar en cualquier momento.
            </div>
          </div>
          
          {/* Payment Button */}
          <Button
            onClick={handlePayment}
            disabled={loading || success}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirigiendo a Tilopay...
              </>
            ) : success ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                ¡Suscripción Activada!
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4 mr-2" />
                Continuar a Pago Seguro
              </>
            )}
          </Button>

          <div className="text-xs text-muted-foreground space-y-1 text-center">
            <p>🔒 Pago seguro procesado por Tilopay</p>
            <p>💳 Monto: ₡{amountCRC.toLocaleString()} / mes</p>
            <p>🔄 Cancele en cualquier momento desde su panel</p>
          </div>
        </div>
      </Card>
  );
}
