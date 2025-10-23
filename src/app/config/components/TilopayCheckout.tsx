'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

/**
 * Tilopay Checkout Component
 * Implements official Tilopay SDK integration
 * Based on documentation from admin.tilopay.com
 */

declare global {
  interface Window {
    Tilopay: any;
    $: any;
  }
}

interface TilopayCheckoutProps {
  planId: string;
  amount: number;
  onClose?: () => void;
}

export default function TilopayCheckout({ planId, amount, onClose }: TilopayCheckoutProps) {
  const [sdkToken, setSdkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  const initializePayment = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔐 Requesting SDK token...');
      
      // Get SDK token from backend
      const response = await fetch('/api/tilopay/get-sdk-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ planId, amount })
      });

      const data = await response.json();
      console.log('📦 SDK response:', data);
      
      if (data.status === 'success' && data.token) {
        setSdkToken(data.token);
        
        // Wait for SDK to be ready
        const checkSDK = setInterval(() => {
          if (window.Tilopay && window.$) {
            clearInterval(checkSDK);
            
            console.log('🎯 Initializing Tilopay SDK...');
            
            try {
              const initResponse = window.Tilopay.Init({
                token: data.token,
                currency: 'CRC',
                language: 'es',
                amount: amount,
                subscription: 1 // Save card for recurring payments
              });

              console.log('📦 Init response:', initResponse);

              if (initResponse.message === 'Success') {
                console.log('✅ Tilopay SDK initialized');
                console.log('📦 Environment:', initResponse.environment);
                
                // Populate payment methods
                if (initResponse.methods && initResponse.methods.length > 0) {
                  const methodSelect = document.getElementById('tilopay-method') as HTMLSelectElement;
                  if (methodSelect) {
                    methodSelect.innerHTML = '<option value="">Seleccione método de pago</option>';
                    initResponse.methods.forEach((method: any) => {
                      const option = document.createElement('option');
                      option.value = method.id;
                      option.textContent = method.name;
                      methodSelect.appendChild(option);
                      console.log('💳 Payment method:', method.name);
                    });
                  }
                }
                
                setSdkReady(true);
              } else {
                setError('Error al inicializar pago: ' + initResponse.message);
                console.error('❌ Init failed:', initResponse);
              }
            } catch (initError: any) {
              console.error('❌ Init error:', initError);
              setError('Error al inicializar SDK: ' + initError.message);
            }
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!sdkReady) {
            clearInterval(checkSDK);
            setError('Timeout cargando SDK de pago. Intente nuevamente.');
          }
        }, 10000);
        
      } else {
        setError(data.error || 'Error al generar token de pago');
        console.error('❌ Token generation failed:', data);
      }
    } catch (error: any) {
      console.error('❌ Error initializing payment:', error);
      setError('Error de conexión: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const processPayment = () => {
    if (window.Tilopay) {
      console.log('💳 Processing payment...');
      
      try {
        const response = window.Tilopay.startPayment();
        console.log('📦 Payment response:', response);
        
        if (response.message !== 'Success') {
          setError('Error al procesar pago: ' + response.message);
        }
        // SDK handles redirect to callback automatically
      } catch (payError: any) {
        console.error('❌ Payment error:', payError);
        setError('Error al procesar pago: ' + payError.message);
      }
    } else {
      setError('SDK no está listo. Intente nuevamente.');
    }
  };

  return (
    <>
      {/* Load jQuery (required by Tilopay SDK) */}
      <Script 
        src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"
        strategy="beforeInteractive"
      />
      
      {/* Load Tilopay SDK */}
      <Script 
        src="https://app.tilopay.com/sdk/v1/sdk.min.js"
        strategy="afterInteractive"
        onLoad={() => console.log('✅ Tilopay SDK loaded')}
        onError={() => setError('Error cargando SDK de Tilopay')}
      />
      
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
        
        <p className="text-gray-600">Monto: ₡{amount.toLocaleString()} / mes</p>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        
        {!sdkToken ? (
          <button 
            onClick={initializePayment}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Cargando...' : 'Iniciar Pago'}
          </button>
        ) : (
          <>
            <div className="payFormTilopay space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Método de Pago</label>
                <select 
                  id="tilopay-method"
                  name="method" 
                  className="w-full p-2 border rounded"
                >
                  <option value="">Seleccione método de pago</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Número de Tarjeta</label>
                <input 
                  type="text" 
                  id="ccnumber" 
                  name="ccnumber" 
                  placeholder="4111111111111111"
                  className="w-full p-2 border rounded"
                  maxLength={19}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Prueba: 4111111111111111 (Visa)
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Vencimiento (MM/AA)</label>
                  <input 
                    type="text" 
                    id="expdate" 
                    name="expdate" 
                    placeholder="12/25"
                    className="w-full p-2 border rounded"
                    maxLength={5}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">CVV</label>
                  <input 
                    type="text" 
                    id="cvv" 
                    name="cvv" 
                    placeholder="123"
                    className="w-full p-2 border rounded"
                    maxLength={4}
                  />
                </div>
              </div>
              
              <button 
                onClick={processPayment}
                disabled={!sdkReady}
                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {sdkReady ? 'Completar Pago' : 'Inicializando...'}
              </button>
            </div>
            
            {/* Container for 3DS challenges */}
            <div id="result"></div>
          </>
        )}
        
        <div className="text-xs text-gray-500 space-y-1">
          <p>🔒 Pago seguro procesado por Tilopay</p>
          <p>💳 Su tarjeta será guardada para cargos recurrentes</p>
        </div>
      </div>
    </>
  );
}

