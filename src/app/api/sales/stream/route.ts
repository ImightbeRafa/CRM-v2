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

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SCRIPT_URL) {
    return NextResponse.json(
      { error: 'Script URL not configured' },
      { status: 500 }
    )
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SCRIPT_URL}?type=list`,
      {
        headers: {
          'Cache-Control': 'no-cache',
        },
        next: { revalidate: 0 }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    
    try {
      const data = JSON.parse(text);
      if (data.status === 'error') {
        throw new Error(data.error || 'Unknown error from server');
      }
      return NextResponse.json(data);
    } catch (jsonError) {
      const sales = parsePipeDelimitedData(text);
      return NextResponse.json({
        status: 'success',
        data: sales
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to fetch sales data'
      },
      { status: 500 }
    );
  }
}