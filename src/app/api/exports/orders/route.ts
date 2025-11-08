import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import { exportRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHeaders = exportRateLimit(request);
    if (rateLimitHeaders instanceof Response) {
      return rateLimitHeaders; // Rate limit exceeded
    }
    
    // Authenticate and check permissions
    const auth = await authenticateAPIWithPermission(request, 'view_sales');
    if (!auth.ok) return auth.response;
    
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');
    
    // Validate format
    if (!['json', 'csv', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx' },
        { status: 400 }
      );
    }
    
    const prisma = getTenantPrisma(auth.tenantId);
    
    // Build where clause for filtering
    const whereClause: any = {};
    
    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) whereClause.timestamp.gte = new Date(startDate);
      if (endDate) whereClause.timestamp.lte = new Date(endDate);
    }
    
    if (status) {
      whereClause.status = status;
    }
    
    // Fetch orders with related data
    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: {
        timestamp: 'desc'
      }
    });
    
    // Transform data for export
    const exportData = orders.map(order => ({
      id: order.id,
      orderNumber: order.orderId,
      status: order.status,
      total: order.total,
      clientName: order.customerName || 'N/A',
      clientEmail: order.email || 'N/A',
      clientPhone: order.phone || 'N/A',
      sellerName: order.username || 'N/A',
      sellerEmail: order.email || 'N/A',
      itemsCount: 1, // Since schema is flat, treat each order as 1 item
      items: [{
        productName: order.product || 'N/A',
        quantity: order.quantity,
        price: order.productCost || 0,
        subtotal: order.quantity * (order.productCost || 0)
      }],
      createdAt: order.timestamp.toISOString(),
      updatedAt: order.timestamp.toISOString(),
    }));
    
    // Generate export based on format
    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;
    
    const timestamp = new Date().toISOString().split('T')[0];
    
    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `orders-export-${timestamp}.json`;
        break;
        
      case 'csv':
        const csvParser = new Parser({
          fields: [
            'id',
            'orderNumber',
            'status',
            'total',
            'clientName',
            'clientEmail',
            'clientPhone',
            'sellerName',
            'sellerEmail',
            'itemsCount',
            'createdAt',
            'updatedAt'
          ]
        });
        exportContent = csvParser.parse(exportData);
        contentType = 'text/csv';
        filename = `orders-export-${timestamp}.csv`;
        break;
        
      case 'xlsx':
        // Dynamic import to reduce bundle size for non-xlsx exports
        const XLSX = await import('xlsx');
        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
        
        // Generate buffer
        exportContent = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `orders-export-${timestamp}.xlsx`;
        break;
        
      default:
        throw new Error('Unsupported format');
    }
    
    // Return file download
    return new NextResponse(exportContent as any, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportContent.length.toString(),
        ...rateLimitHeaders, // Add rate limit headers
      },
    });
    
  } catch (error) {
    console.error('Error exporting orders:', error);
    return NextResponse.json(
      { 
        error: 'Failed to export orders',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
