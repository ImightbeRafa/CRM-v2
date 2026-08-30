// Integration types for external website orders
export interface ExternalOrderData {
  orderId: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  product: {
    name: string;
    quantity: number;
    unitPrice: string;
  };
  /** Omit or EA = envío (current websites). RA = retiro; shipping may be omitted. */
  orderType?: 'EA' | 'RA';
  pickupDate?: string;
  shipping?: {
    cost: string;
    courier?: string;
    address: {
      province: string;
      canton: string;
      district: string;
      fullAddress: string;
    };
  };
  total: string;
  payment?: {
    method?: string;
    transactionId?: string;
    status?: string;
    date?: string;
  };
  // Optional metadata
  source?: string; // Website name/identifier
  salesChannel?: string;
  seller?: string;
  metadata?: Record<string, any>;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  keyHash: string;
  name: string;
  active: boolean;
  lastUsed?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationStats {
  totalOrders: number;
  lastOrderDate?: Date;
  errorCount: number;
  lastErrorDate?: Date;
}
