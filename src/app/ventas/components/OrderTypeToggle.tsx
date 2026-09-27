import React from 'react';

interface OrderTypeToggleProps {
  orderType: 'EA' | 'RA';
  onOrderTypeChange: (type: 'EA' | 'RA') => void;
}

const OrderTypeToggle: React.FC<OrderTypeToggleProps> = ({ orderType, onOrderTypeChange }) => {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Tipo de pedido">
      <button
        type="button"
        role="radio"
        aria-checked={orderType === 'EA'}
        className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-all ${
          orderType === 'EA'
            ? 'bg-white text-[#5B3FE0] shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
        }`}
        onClick={() => onOrderTypeChange('EA')}
      >
        Envío
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={orderType === 'RA'}
        className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-all ${
          orderType === 'RA'
            ? 'bg-white text-[#5B3FE0] shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
        }`}
        onClick={() => onOrderTypeChange('RA')}
      >
        Retiro
      </button>
    </div>
  );
};

export default OrderTypeToggle;