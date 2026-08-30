'use client';

import React, { useState, useEffect } from 'react';
import { Truck } from 'lucide-react';

interface ShippingOption {
  id: string;
  label: string;
  value: string;
  priceDelta: number;
}

interface ShippingMethodSelectorProps {
  selectedMethod?: string;
  onMethodChange: (method: string, cost: number) => void;
  error?: string;
}

export function ShippingMethodSelector({ selectedMethod, onMethodChange, error }: ShippingMethodSelectorProps) {
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualCourier, setManualCourier] = useState('');

  useEffect(() => {
    loadShippingOptions();
  }, []);

  useEffect(() => {
    if (selectedMethod && !shippingOptions.some(option => option.value === selectedMethod)) {
      setManualCourier(selectedMethod);
    }
  }, [selectedMethod, shippingOptions]);

  const loadShippingOptions = async () => {
    try {
      const shippingRes = await fetch('/api/config/shipping', { credentials: 'include' });
      const shippingJson = await shippingRes.json().catch(() => null);
      if (shippingJson?.status === 'success' && Array.isArray(shippingJson.data) && shippingJson.data.length > 0) {
        setShippingOptions(shippingJson.data.map((method: { id: string; name: string; basePrice?: number }) => ({
          id: method.id,
          label: method.name,
          value: method.name,
          priceDelta: Number(method.basePrice || 0),
        })));
        return;
      }

      const fieldsRes = await fetch('/api/config/fields', { credentials: 'include' });
      const fieldsJson = await fieldsRes.json();
      if (fieldsJson.status === 'success') {
        const shippingField = fieldsJson.data.find((field: { key?: string }) => field.key === 'metodoEnvio');
        if (shippingField?.optionSet?.options) {
          setShippingOptions(shippingField.optionSet.options);
        }
      }
    } catch (loadError) {
      console.error('Error loading shipping options:', loadError);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '__manual__') {
      onMethodChange(manualCourier.trim(), 0);
      return;
    }
    if (!value) {
      onMethodChange('', 0);
      return;
    }
    const option = shippingOptions.find(opt => opt.value === value);
    onMethodChange(option?.value || value, option?.priceDelta || 0);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-field="orderShippingMethod">
        <Truck className="w-4 h-4 animate-pulse" />
        <span>Cargando métodos de envío...</span>
      </div>
    );
  }

  const selectValue = shippingOptions.some(option => option.value === selectedMethod)
    ? selectedMethod
    : (selectedMethod ? '__manual__' : '');

  return (
    <div className="flex flex-col space-y-2" data-field="orderShippingMethod">
      <label htmlFor="shippingMethod" className="text-sm font-medium text-foreground flex items-center gap-2">
        <Truck className="w-4 h-4" />
        Mensajería <span className="text-red-500">*</span>
      </label>
      {shippingOptions.length > 0 ? (
        <select
          id="shippingMethod"
          value={selectValue || ''}
          onChange={handleChange}
          aria-required="true"
          aria-invalid={Boolean(error)}
          className={`w-full px-3 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
            error ? 'border-red-500' : 'border-border'
          }`}
        >
          <option value="">Seleccionar mensajería...</option>
          {shippingOptions.map((option) => (
            <option key={option.id} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="__manual__">Otra (escribir)</option>
        </select>
      ) : (
        <p className="text-xs text-muted-foreground">
          No hay mensajerías configuradas. Escribe el nombre del courier.
        </p>
      )}
      {(shippingOptions.length === 0 || selectValue === '__manual__') && (
        <input
          type="text"
          value={manualCourier}
          onChange={(event) => {
            setManualCourier(event.target.value);
            onMethodChange(event.target.value, 0);
          }}
          placeholder="Nombre de la mensajería"
          aria-required="true"
          aria-invalid={Boolean(error)}
          className={`w-full px-3 py-2 border rounded-md bg-background text-sm ${
            error ? 'border-red-500' : 'border-border'
          }`}
        />
      )}
      {selectedMethod && shippingOptions.some(option => option.value === selectedMethod) && (
        <p className="text-xs text-muted-foreground">
          Costo de envío: ₡{(shippingOptions.find(option => option.value === selectedMethod)?.priceDelta || 0).toLocaleString('es-CR')}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
