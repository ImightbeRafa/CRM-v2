import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    // Authenticate and check permissions
    const session = await authenticateAPIWithPermission(request, 'view_sales');
    
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
    
    const prisma = getTenantPrisma(session.user.tenantId);
    
    // Build where clause for filtering
    const whereClause: any = {};
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = new Date(startDate);
      if (endDate) whereClause.createdAt.lte = new Date(endDate);
    }
    
    if (status) {
      whereClause.status = status;
    }
    
    // Fetch orders with related data
    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            name: true,
            email: true,
            phone: true,
          }
        },
        seller: {
          select: {
            name: true,
            email: true,
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                price: true,
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Transform data for export
    const exportData = orders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      clientName: order.client?.name || 'N/A',
      clientEmail: order.client?.email || 'N/A',
      clientPhone: order.client?.phone || 'N/A',
      sellerName: order.seller?.name || 'N/A',
      sellerEmail: order.seller?.email || 'N/A',
      itemsCount: order.orderItems.length,
      items: order.orderItems.map(item => ({
        productName: item.product?.name || 'N/A',
        quantity: item.quantity,
        price: item.product?.price || 0,
        subtotal: item.quantity * (item.product?.price || 0)
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
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
    return new NextResponse(exportContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportContent.length.toString(),
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
