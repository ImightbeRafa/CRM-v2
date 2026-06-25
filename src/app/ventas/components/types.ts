export interface CustomerInfo {
  name: string;
  phone: string;
  province: string;
  canton: string;
  district: string;
  email: string;
  username: string;
  address: string;
  business: string;
  funnel: string;
  comments: string;
  fechaEsperada: string;
  fechaRetiro: string;
  diaVenta: string;
  orderType: 'EA' | 'RA';
  [key: string]: any;
}

export interface ProductInfo {
  id: string;
  type: string;
  color: string;
  packaging: string;
  comments: string;
  cantidad: number;
  productCost: number;
  shippingCost: number;
  iva: number;
  total: number;
  vendedor: string;
  mensajeria?: string;
  tamano?: string;
  personalizado?: string;
  optionDeltas?: number;
  [key: string]: any;
}

export interface OrderInfo {
  customerInfo: CustomerInfo;
  products: ProductInfo[];
  orderTotal: number;
  orderIVA: number;
  orderSubtotal: number;
  orderShipping: number;
  applyOrderIVA?: boolean;
  orderShippingMethod?: string;
  contraEntrega?: boolean;
}

export interface SubmitStatus {
  type: string;
  message: string;
}

export interface ProductTemplate {
  id?: string;
  name?: string;
  type: string;
  color: string;
  baseCost: number;
  tamano?: string;
  category?: string;
  sku?: string;
  currentStock?: number;
  isFavorite?: boolean;
  lastUsed?: string | Date;
}

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  email?: string;
  province: string;
  canton: string;
  district: string;
  address?: string;
  business?: string;
  username?: string;
  totalOrders?: number;
  totalSpent?: number;
  lastOrder?: string | Date;
}
