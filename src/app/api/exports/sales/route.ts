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
    const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month, year
    
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
    
    // Fetch sales data with aggregations
    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            name: true,
            email: true,
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
                category: true,
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Process and aggregate sales data
    const salesData = orders.map(order => {
      const orderDate = new Date(order.createdAt);
      const dateKey = getDateKey(orderDate, groupBy);
      
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        date: dateKey,
        total: order.total,
        clientName: order.client?.name || 'N/A',
        clientEmail: order.client?.email || 'N/A',
        sellerName: order.seller?.name || 'N/A',
        sellerEmail: order.client?.email || 'N/A',
        itemsCount: order.orderItems.length,
        items: order.orderItems.map(item => ({
          productName: item.product?.name || 'N/A',
          category: item.product?.category || 'N/A',
          quantity: item.quantity,
          price: item.product?.price || 0,
          subtotal: item.quantity * (item.product?.price || 0)
        })),
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      };
    });
    
    // Group by date if requested
    let exportData = salesData;
    if (groupBy !== 'none') {
      exportData = groupSalesByDate(salesData, groupBy);
    }
    
    // Generate export based on format
    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;
    
    const timestamp = new Date().toISOString().split('T')[0];
    
    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `sales-export-${timestamp}.json`;
        break;
        
      case 'csv':
        const csvParser = new Parser({
          fields: [
            'id',
            'orderNumber',
            'date',
            'total',
            'clientName',
            'clientEmail',
            'sellerName',
            'sellerEmail',
            'itemsCount',
            'createdAt',
            'updatedAt'
          ]
        });
        exportContent = csvParser.parse(exportData);
        contentType = 'text/csv';
        filename = `sales-export-${timestamp}.csv`;
        break;
        
      case 'xlsx':
        // Create workbook with multiple sheets
        const workbook = XLSX.utils.book_new();
        
        // Sales data sheet
        const salesSheet = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(workbook, salesSheet, 'Sales');
        
        // Summary sheet
        const summaryData = generateSalesSummary(exportData);
        const summarySheet = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
        
        // Generate buffer
        exportContent = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `sales-export-${timestamp}.xlsx`;
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
    console.error('Error exporting sales:', error);
    return NextResponse.json(
      { 
        error: 'Failed to export sales',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Helper function to get date key for grouping
function getDateKey(date: Date, groupBy: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const week = Math.ceil(date.getDate() / 7);
  
  switch (groupBy) {
    case 'day':
      return `${year}-${month}-${day}`;
    case 'week':
      return `${year}-W${week}`;
    case 'month':
      return `${year}-${month}`;
    case 'year':
      return `${year}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

// Helper function to group sales by date
function groupSalesByDate(salesData: any[], groupBy: string): any[] {
  const grouped = salesData.reduce((acc, sale) => {
    const key = sale.date;
    if (!acc[key]) {
      acc[key] = {
        date: key,
        totalSales: 0,
        ordersCount: 0,
        clientsCount: new Set(),
        sellersCount: new Set(),
        itemsCount: 0,
        orders: []
      };
    }
    
    acc[key].totalSales += sale.total;
    acc[key].ordersCount += 1;
    acc[key].clientsCount.add(sale.clientName);
    acc[key].sellersCount.add(sale.sellerName);
    acc[key].itemsCount += sale.itemsCount;
    acc[key].orders.push(sale);
    
    return acc;
  }, {});
  
  return Object.values(grouped).map((group: any) => ({
    date: group.date,
    totalSales: group.totalSales,
    ordersCount: group.ordersCount,
    clientsCount: group.clientsCount.size,
    sellersCount: group.sellersCount.size,
    itemsCount: group.itemsCount,
    averageOrderValue: group.totalSales / group.ordersCount,
  }));
}

// Helper function to generate sales summary
function generateSalesSummary(salesData: any[]): any[] {
  const totalSales = salesData.reduce((sum, sale) => sum + sale.total, 0);
  const totalOrders = salesData.length;
  const uniqueClients = new Set(salesData.map(sale => sale.clientName)).size;
  const uniqueSellers = new Set(salesData.map(sale => sale.sellerName)).size;
  const totalItems = salesData.reduce((sum, sale) => sum + sale.itemsCount, 0);
  
  return [
    {
      metric: 'Total Sales',
      value: totalSales,
      currency: 'USD'
    },
    {
      metric: 'Total Orders',
      value: totalOrders,
      currency: 'count'
    },
    {
      metric: 'Unique Clients',
      value: uniqueClients,
      currency: 'count'
    },
    {
      metric: 'Unique Sellers',
      value: uniqueSellers,
      currency: 'count'
    },
    {
      metric: 'Total Items',
      value: totalItems,
      currency: 'count'
    },
    {
      metric: 'Average Order Value',
      value: totalOrders > 0 ? totalSales / totalOrders : 0,
      currency: 'USD'
    }
  ];
}
