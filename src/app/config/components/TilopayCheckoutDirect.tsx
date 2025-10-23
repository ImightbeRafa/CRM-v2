'use client';

import { useState } from 'react';

/**
 * Tilopay Direct Integration (No SDK)
 * Uses REST API directly for payment links
 * Workaround for SDK token generation issues
 */

interface TilopayCheckoutDirectProps {
  planId: string;
  amount: number;
  onClose?: () => void;
}

export default function TilopayCheckoutDirect({ planId, amount, onClose }: TilopayCheckoutDirectProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPaymentLink = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔐 Creating Tilopay payment link directly...');
      
      // Call our backend to create payment link via REST API
      const response = await fetch('/api/tilopay/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ planId, amount })
      });

      const data = await response.json();
      console.log('📦 Response:', data);
      
      if (data.status === 'success' && data.paymentUrl) {
        console.log('✅ Redirecting to Tilopay...');
        // Redirect to Tilopay payment page
        window.location.href = data.paymentUrl;
      } else {
        setError(data.error || 'Error al crear enlace de pago');
      }
    } catch (error: any) {
      console.error('❌ Error:', error);
      setError('Error de conexión: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Actualizar a {planId.toUpperCase()}</h3>
        {onClose && (
          <button 
            onClick={onClose}
            className="text-gray-600 hover:text-gray-800"
          >
            ✕
          </button>
        )}
      </div>
      
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Plan: {planId.toUpperCase()}</strong>
          </p>
          <p className="text-2xl font-bold text-blue-900 mt-2">
            ₡{amount.toLocaleString()} / mes
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="space-y-2 text-sm text-gray-600">
          <p>✓ Pago seguro con Tilopay</p>
          <p>✓ Tarjetas: Visa, Mastercard, Amex</p>
          <p>✓ Métodos locales: Sinpe Móvil</p>
          <p>✓ Renovación automática mensual</p>
        </div>

        <button 
          onClick={createPaymentLink}
          disabled={loading}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
        >
          {loading ? 'Creando enlace...' : 'Continuar al Pago'}
        </button>

        <p className="text-xs text-gray-500 text-center">
          Será redirigido a Tilopay para completar el pago de forma segura
        </p>
      </div>
    </div>
  );
}

