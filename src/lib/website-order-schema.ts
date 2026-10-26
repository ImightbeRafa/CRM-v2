import { z } from 'zod';

const shippingSchema = z.object({
  cost: z.string().min(1),
  courier: z.string().optional(),
  address: z.object({
    province: z.string().min(1),
    canton: z.string().min(1),
    district: z.string().min(1),
    fullAddress: z.string().min(1),
  }),
});

export const externalOrderIntakeSchema = z.object({
  orderId: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().email().optional(),
  }),
  product: z.object({
    name: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.string().min(1),
    /**
     * Optional (lane J): the store's SKU, so the order shows the exact inventory item. Never rejects an order:
     * anything that is not a usable SKU ("", null, a number, > 64 chars) is treated as "no SKU", as before.
     */
    sku: z.preprocess(
      (value) => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed && trimmed.length <= 64 ? trimmed : undefined;
      },
      z.string().optional(),
    ),
  }),
  /**
   * Optional cart lines `[{ name, quantity, unitPrice?, lineTotal?, sku?, variant? }]` (`lineItems` / `products`
   * are older spellings some stores already send). Read leniently by parseWebsiteItems: an unusable list is
   * ignored, never a rejected order.
   */
  items: z.unknown().optional(),
  lineItems: z.unknown().optional(),
  products: z.unknown().optional(),
  orderType: z.enum(['EA', 'RA']).optional(),
  pickupDate: z.string().optional(),
  shipping: shippingSchema.optional(),
  total: z.string().min(1),
  payment: z.object({
    method: z.string().min(1).optional(),
    transactionId: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
  }).optional(),
  source: z.string().optional(),
  salesChannel: z.string().optional(),
  seller: z.string().optional(),
  metadata: z.record(z.any()).optional(),
}).superRefine((data, ctx) => {
  if (data.orderType === 'RA') return;
  if (!data.shipping) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shipping'],
      message: 'shipping is required for envío (EA) orders',
    });
  }
});
