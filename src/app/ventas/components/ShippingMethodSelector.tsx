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
}

export function ShippingMethodSelector({ selectedMethod, onMethodChange }: ShippingMethodSelectorProps) {
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShippingOptions();
  }, []);

  const loadShippingOptions = async () => {
    try {
      // Load the metodoEnvio field with its options
      const fieldsRes = await fetch('/api/config/fields');
      const fieldsJson = await fieldsRes.json();
      
      if (fieldsJson.status === 'success') {
        const shippingField = fieldsJson.data.find((f: any) => f.key === 'metodoEnvio');
        
        if (shippingField?.optionSet?.options) {
          setShippingOptions(shippingField.optionSet.options);
        }
      }
    } catch (error) {
      console.error('Error loading shipping options:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) {
      onMethodChange('', 0);
      return;
    }

    const option = shippingOptions.find(opt => opt.value === value);
    if (option) {
      onMethodChange(option.value, option.priceDelta);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Truck className="w-4 h-4 animate-pulse" />
        <span>Cargando métodos de envío...</span>
      </div>
    );
  }

  if (shippingOptions.length === 0) {
    return null; // Don't show if no shipping options configured
  }

  return (
    <div className="flex flex-col space-y-2">
      <label htmlFor="shippingMethod" className="text-sm font-medium text-gray-700 flex items-center gap-2">
        <Truck className="w-4 h-4" />
        Método de Envío
      </label>
      <select
        id="shippingMethod"
        value={selectedMethod || ''}
        onChange={handleChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      >
        <option value="">Seleccionar método de envío...</option>
        {shippingOptions.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {selectedMethod && (
        <p className="text-xs text-gray-500">
          Costo de envío: ₡{shippingOptions.find(o => o.value === selectedMethod)?.priceDelta.toLocaleString() || 0}
        </p>
      )}
    </div>
  );
}

