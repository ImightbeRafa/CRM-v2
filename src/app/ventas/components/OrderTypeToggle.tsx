import React from 'react';

interface OrderTypeToggleProps {
  orderType: 'EA' | 'RA';
  onOrderTypeChange: (type: 'EA' | 'RA') => void;
}

const OrderTypeToggle: React.FC<OrderTypeToggleProps> = ({ orderType, onOrderTypeChange }) => {
  return (
    <div className="flex justify-center space-x-2 mb-6">
      <button
        type="button"
        className={`px-4 py-2 rounded-l-lg ${
          orderType === 'EA'
            ? 'bg-blue-500 text-white'
            : 'bg-muted text-muted-foreground'
        }`}
        onClick={() => onOrderTypeChange('EA')}
      >
        Envío
      </button>
      <button
        type="button"
        className={`px-4 py-2 rounded-r-lg ${
          orderType === 'RA'
            ? 'bg-blue-500 text-white'
            : 'bg-muted text-muted-foreground'
        }`}
        onClick={() => onOrderTypeChange('RA')}
      >
        Retiro
      </button>
    </div>
  );
};

export default OrderTypeToggle;