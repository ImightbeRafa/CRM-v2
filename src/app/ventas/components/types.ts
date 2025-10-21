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
  funnel: 'Instagram' | 'Whatsapp' | ''; // Add this line
  fechaEsperada: string;
  fechaRetiro: string;
  diaVenta: string;
  orderType: 'EA' | 'RA';
  // Dynamic business fields
  [key: string]: any;
}

export interface ProductInfo {
  id: string; // Add unique ID for each product
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
  mensajeria: string;
  tamano: string;
  personalizado: string;
  // Add option deltas for dynamic pricing
  optionDeltas?: number;
}

export interface OrderInfo {
  customerInfo: CustomerInfo;
  products: ProductInfo[];
  orderTotal: number;
  orderIVA: number;
  orderSubtotal: number;
  orderShipping: number;
  orderShippingMethod?: string;
  applyOrderIVA?: boolean;
}

export interface SubmitStatus {
  type: 'success' | 'error' | '';
  message: string;
}

// New interfaces for enhanced functionality
export interface ProductTemplate {
  id: string;
  name: string;
  type: string;
  color: string;
  tamano: string;
  baseCost: number;
  isFavorite: boolean;
  lastUsed?: Date;
}

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  province: string;
  canton: string;
  district: string;
  email?: string;
  username?: string;
  address?: string;
  business?: string;
  lastOrder?: Date;
  totalOrders: number;
}

export interface FormAutoSave {
  customerInfo: CustomerInfo;
  products: ProductInfo[];
  lastSaved: Date;
  hasUnsavedChanges: boolean;
}