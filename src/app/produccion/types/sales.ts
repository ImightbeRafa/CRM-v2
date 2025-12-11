// hooks/types.ts
export interface BaseOrder {
  id: string;
  orderId: string;
  status: string;
  delivery: string;
  timestamp: string;
  customerName: string;
  username: string;
  phone: string;
  email: string;
  business: string;
  product: string;
  quantity: number;
  size: string;
  color: string;
  packaging: string;
  customization: string;
  comments: string;
  total: number;
  orderType: 'EA' | 'RA';
}

export interface EAOrder extends BaseOrder {
  orderType: 'EA';
  expectedDate: string;
  saleDate: string;
  courier: string;
  seller: string;
  province: string;
  canton: string;
  district: string;
  address: string;
  productCost: number;
  shippingCost: number;
  iva: number;
  funnel?: string;
}

export interface RAOrder extends BaseOrder {
  orderType: 'RA';
  seller: string;
  agreedDate: string;
  pickupDate: string;
  productCost: number;
  iva: number;
  funnel?: string;
  address: string;
}

export type Sale = EAOrder | RAOrder;

// Ensure renderField accepts keys from both EAOrder and RAOrder
export type SaleKeys = keyof (EAOrder & RAOrder);