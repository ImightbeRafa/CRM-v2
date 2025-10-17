import { NextResponse } from 'next/server'
import { SaleData } from './types'

export const dynamic = 'force-dynamic'

function parsePipeDelimitedData(text: string): SaleData[] {
  try {
    return text.split(';')
      .filter(Boolean)
      .map(sale => {
        const fields = sale.split('|').map(s => s.trim());
        
        const [
          orderId,          // 0
          customerName,     // 1
          total,           // 2
          timestamp,       // 3
          orderType,       // 4
          phone,           // 5
          email,           // 6
          address,         // 7
          product,         // 8
          status,          // 9
          business,        // 10
          funnel,          // 11
          quantity,        // 12
          size,           // 13
          color,          // 14
          packaging,       // 15
          customization,   // 16
          comments,        // 17
          productCost,     // 18
          iva,            // 19
          username,        // 20
          expectedDate,    // 21
          saleDate,       // 22
          courier,        // 23
          sellerEA,       // 24
          province,       // 25
          canton,         // 26
          district,       // 27
          shippingCost,   // 28
          sellerRA,       // 29
          agreedDate,     // 30
          pickupDate      // 31
        ] = fields;

        const baseSale = {
          orderId: orderId || '',
          status: status || 'Pendiente',
          delivery: '',
          customerName: customerName || '',
          username: username || '',
          phone: phone || '',
          email: email || '',
          business: business || 'No especificado',
          product: product || '',
          quantity: Number(quantity) || 0,
          size: size || '',
          color: color || '',
          packaging: packaging || '',
          customization: customization || '',
          comments: comments || '',
          productCost: Number(productCost) || 0,
          iva: Number(iva) || 0,
          total: Number(total) || 0,
          timestamp: timestamp || new Date().toISOString(),
          funnel: funnel || 'No especificado'
        };

        if (orderType === 'EA') {
          return {
            ...baseSale,
            orderType: 'EA' as const,
            expectedDate: expectedDate || '',
            saleDate: saleDate || '',
            courier: courier || '',
            seller: sellerEA || '',
            province: province || '',
            canton: canton || '',
            district: district || '',
            address: address || '',
            shippingCost: Number(shippingCost) || 0
          };
        } else {
          return {
            ...baseSale,
            orderType: 'RA' as const,
            seller: sellerRA || '',
            agreedDate: agreedDate || '',
            pickupDate: pickupDate || ''
          };
        }
      });
  } catch (error) {
    throw new Error('Failed to parse sales data');
  }
}

import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { timestamp: 'desc' }
    })
    return NextResponse.json({ status: 'success', data: orders })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : ''
    // Handle missing table during first run before migrations
    if (error?.code === 'P2021' || message.includes('no such table')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json(
      { status: 'error', error: message || 'Failed to fetch sales data' },
      { status: 500 }
    )
  }
}