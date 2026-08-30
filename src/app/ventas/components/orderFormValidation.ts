import { CustomerInfo, ProductInfo } from './types';

export type OrderFieldErrors = Record<string, string>;

interface ValidateOrderFormInput {
  customerInfo: CustomerInfo;
  products: ProductInfo[];
  orderShippingMethod?: string;
  businessInfoFields: Array<{ name?: string; label?: string; required?: boolean }>;
}

export function validateOrderForm(input: ValidateOrderFormInput): OrderFieldErrors {
  const errors: OrderFieldErrors = {};
  const { customerInfo, products, orderShippingMethod, businessInfoFields } = input;
  const isShippingOrder = customerInfo.orderType === 'EA';

  if (!customerInfo.name.trim()) {
    errors.name = 'El nombre del cliente es requerido';
  }
  if (!customerInfo.phone.trim()) {
    errors.phone = 'El teléfono del cliente es requerido';
  }

  if (isShippingOrder) {
    if (!customerInfo.province.trim()) {
      errors.province = 'La provincia es requerida para envíos';
    }
    if (!customerInfo.canton.trim()) {
      errors.canton = 'El cantón es requerido para envíos. Elígelo de la lista.';
    }
    if (!customerInfo.district.trim()) {
      errors.district = 'El distrito es requerido para envíos';
    }
    if (!customerInfo.address.trim()) {
      errors.address = 'La dirección es requerida para envíos';
    }
    if (!orderShippingMethod?.trim()) {
      errors.orderShippingMethod = 'La mensajería es requerida para envíos';
    }
  }

  if (products.length === 0) {
    errors.products = 'Debe agregar al menos un producto al pedido';
  }

  products.forEach((product, index) => {
    const n = index + 1;
    if (!product.type.trim()) {
      errors[`product-${index}-type`] = `El producto #${n} necesita un nombre`;
    }
    if (product.cantidad <= 0) {
      errors[`product-${index}-cantidad`] = `La cantidad del producto #${n} debe ser mayor a 0`;
    }
    if (product.productCost <= 0) {
      errors[`product-${index}-cost`] = `El precio del producto #${n} debe ser mayor a ₡0`;
    }
    if (!product.vendedor.trim()) {
      errors[`product-${index}-vendedor`] = `El vendedor del producto #${n} es requerido`;
    }
  });

  for (const field of businessInfoFields) {
    if (!field.required || !field.name) continue;
    const value = customerInfo[field.name];
    if (!value || (typeof value === 'string' && !value.trim())) {
      errors[`business-${field.name}`] = `${field.label || field.name} es requerido`;
    }
  }

  return errors;
}

export function firstOrderFieldError(errors: OrderFieldErrors): string | null {
  const keys = Object.keys(errors);
  return keys.length ? errors[keys[0]] : null;
}

export function draftProductAddBlockedReason(product: {
  type?: string;
  cantidad?: number;
  productCost?: number;
} | null): string | null {
  if (!product) return 'Completa el producto antes de agregarlo';
  if (!product.type?.trim()) return 'Escribe el nombre del producto';
  if (!product.cantidad || product.cantidad < 1) return 'La cantidad debe ser al menos 1';
  if (!product.productCost || product.productCost <= 0) return 'El precio unitario debe ser mayor a ₡0';
  return null;
}
