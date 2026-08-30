import { ExternalOrderData } from '@/types/integration';
import { parseCrcProductAmount, parseCrcShippingAmount } from '@/lib/crc-money';

export type WebsiteOrderCreateFields = {
  orderType: 'EA' | 'RA';
  productCost: number;
  total: number;
  shippingCost: number;
  province: string;
  canton: string;
  district: string;
  address: string;
  courier: string;
  pickupDate: string;
  agreedDate: string;
  comments: string;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled website order type: ${String(value)}`);
}

/**
 * Maps a website intake payload onto CRM order fields.
 * Existing clients that omit orderType stay Envío (EA). Pickup (RA) is
 * opt-in on NEW creates only and never rewrites stored orders.
 */
export function mapWebsiteOrderCreate(orderData: ExternalOrderData): WebsiteOrderCreateFields {
  const orderType = orderData.orderType === 'RA' ? 'RA' : 'EA';
  const comments = typeof orderData.metadata?.comments === 'string' ? orderData.metadata.comments : '';
  const pickupDate = orderType === 'RA' ? (orderData.pickupDate || '') : '';

  switch (orderType) {
    case 'RA':
      return {
        orderType,
        productCost: parseCrcProductAmount(orderData.product.unitPrice, 'Precio unitario'),
        total: parseCrcProductAmount(orderData.total, 'Total'),
        shippingCost: 0,
        province: '',
        canton: '',
        district: '',
        address: '',
        courier: '',
        pickupDate,
        agreedDate: pickupDate,
        comments,
      };
    case 'EA': {
      const shipping = orderData.shipping;
      if (!shipping) {
        throw new Error('Datos de envío requeridos para pedidos EA');
      }
      return {
        orderType,
        productCost: parseCrcProductAmount(orderData.product.unitPrice, 'Precio unitario'),
        total: parseCrcProductAmount(orderData.total, 'Total'),
        shippingCost: parseCrcShippingAmount(shipping.cost, 'Costo de envío'),
        province: shipping.address.province,
        canton: shipping.address.canton,
        district: shipping.address.district,
        address: shipping.address.fullAddress,
        courier: shipping.courier || '',
        pickupDate: '',
        agreedDate: '',
        comments,
      };
    }
    default:
      return assertNever(orderType);
  }
}
