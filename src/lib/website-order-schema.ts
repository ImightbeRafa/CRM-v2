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
  }),
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
