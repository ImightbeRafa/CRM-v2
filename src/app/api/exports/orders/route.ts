import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import { exportRateLimit } from '@/lib/rate-limit';
import ExcelJS from 'exceljs';
import { neutralizeCsvFormula, PII_NO_STORE_HEADERS } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHeaders = await exportRateLimit(request);
    if (rateLimitHeaders instanceof Response) {
      return rateLimitHeaders;
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
    const MAX_EXPORT_ROWS = 10000;
    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: {
        timestamp: 'desc'
      },
      take: MAX_EXPORT_ROWS,
    });
    
    // Transform data for export (CSV formula neutralization on text fields)
    const exportData = orders.map(order => ({
      id: order.id,
      orderNumber: neutralizeCsvFormula(order.orderId),
      status: neutralizeCsvFormula(order.status),
      total: order.total,
      clientName: neutralizeCsvFormula(order.customerName || 'N/A'),
      clientEmail: neutralizeCsvFormula(order.email || 'N/A'),
      clientPhone: neutralizeCsvFormula(order.phone || 'N/A'),
      sellerName: neutralizeCsvFormula(order.username || 'N/A'),
      sellerEmail: neutralizeCsvFormula(order.email || 'N/A'),
      itemsCount: 1, // Since schema is flat, treat each order as 1 item
      items: [{
        productName: neutralizeCsvFormula(order.product || 'N/A'),
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
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Orders');

        if (exportData.length > 0) {
          worksheet.columns = Object.keys(exportData[0])
            .filter(key => key !== 'items')
            .map(key => ({ header: key, key, width: 18 }));
          exportData.forEach(({ items, ...row }) => worksheet.addRow(row));
          worksheet.getRow(1).font = { bold: true };
        }

        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
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
        ...PII_NO_STORE_HEADERS,
        ...rateLimitHeaders, // Add rate limit headers
      },
    });
    
  } catch (error) {
    console.error('Error exporting orders:', error);
    return NextResponse.json(
      { 
        error: 'Failed to export orders'
      },
      { status: 500 }
    );
  }
}
