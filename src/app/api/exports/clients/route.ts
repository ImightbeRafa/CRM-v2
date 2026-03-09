import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';

export async function GET(request: NextRequest) {
  try {
    // Authenticate and check permissions
    const session = await authenticateAPIWithPermission(request, 'view_sales');
    
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const includeOrders = searchParams.get('includeOrders') === 'true';
    const includeStats = searchParams.get('includeStats') === 'true';
    
    // Validate format
    if (!['json', 'csv', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx' },
        { status: 400 }
      );
    }
    
    const prisma = getTenantPrisma(session.user.tenantId);
    
    // Fetch clients with optional related data
    const clients = await prisma.client.findMany({
      include: {
        orders: includeOrders ? {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: {
            createdAt: 'desc'
          }
        } : false,
        _count: {
          select: {
            orders: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    // Transform data for export
    const exportData = await Promise.all(clients.map(async (client) => {
      const baseData = {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        address: client.address,
        city: client.city,
        state: client.state,
        zipCode: client.zipCode,
        country: client.country,
        isActive: client.isActive,
        totalOrders: client._count.orders,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      };
      
      // Add order statistics if requested
      if (includeStats) {
        const orderStats = await prisma.order.aggregate({
          where: { clientId: client.id },
          _sum: { total: true },
          _avg: { total: true },
          _min: { total: true },
          _max: { total: true },
        });
        
        const lastOrder = await prisma.order.findFirst({
          where: { clientId: client.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, total: true }
        });
        
        return {
          ...baseData,
          totalSpent: orderStats._sum.total || 0,
          averageOrderValue: orderStats._avg.total || 0,
          minOrderValue: orderStats._min.total || 0,
          maxOrderValue: orderStats._max.total || 0,
          lastOrderDate: lastOrder?.createdAt.toISOString() || null,
          lastOrderValue: lastOrder?.total || 0,
        };
      }
      
      // Add orders if requested
      if (includeOrders && client.orders) {
        return {
          ...baseData,
          orders: client.orders.map(order => ({
            orderNumber: order.orderNumber,
            status: order.status,
            total: order.total,
            createdAt: order.createdAt.toISOString(),
            updatedAt: order.updatedAt.toISOString(),
          }))
        };
      }
      
      return baseData;
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
        filename = `clients-export-${timestamp}.json`;
        break;
        
      case 'csv':
        // Flatten data for CSV (remove nested objects)
        const flattenedData = exportData.map(client => {
          const { orders, ...flatClient } = client;
          return flatClient;
        });
        
        const csvParser = new Parser({
          fields: [
            'id',
            'name',
            'email',
            'phone',
            'address',
            'city',
            'state',
            'zipCode',
            'country',
            'isActive',
            'totalOrders',
            'totalSpent',
            'averageOrderValue',
            'lastOrderDate',
            'createdAt',
            'updatedAt'
          ]
        });
        exportContent = csvParser.parse(flattenedData);
        contentType = 'text/csv';
        filename = `clients-export-${timestamp}.csv`;
        break;
        
      case 'xlsx':
        // Create workbook with multiple sheets
        const workbook = new ExcelJS.Workbook();
        
        // Clients data sheet
        const clientsWs = workbook.addWorksheet('Clients');
        if (exportData.length > 0) {
          clientsWs.columns = Object.keys(exportData[0]).filter(k => k !== 'orders').map(key => ({ header: key, key, width: 15 }));
          exportData.forEach((row: any) => {
            const { orders, ...rest } = row;
            clientsWs.addRow(rest);
          });
          clientsWs.getRow(1).font = { bold: true };
        }
        
        // Summary sheet
        const summaryData = generateClientsSummary(exportData);
        const summaryWs = workbook.addWorksheet('Summary');
        if (summaryData.length > 0) {
          summaryWs.columns = Object.keys(summaryData[0]).map(key => ({ header: key, key, width: 15 }));
          summaryData.forEach((row: any) => summaryWs.addRow(row));
          summaryWs.getRow(1).font = { bold: true };
        }
        
        // Orders sheet (if included)
        if (includeOrders) {
          const allOrders = exportData.flatMap((client: any) => 
            client.orders?.map((order: any) => ({
              clientName: client.name,
              clientEmail: client.email,
              ...order
            })) || []
          );
          
          if (allOrders.length > 0) {
            const ordersWs = workbook.addWorksheet('Orders');
            ordersWs.columns = Object.keys(allOrders[0]).map(key => ({ header: key, key, width: 15 }));
            allOrders.forEach((row: any) => ordersWs.addRow(row));
            ordersWs.getRow(1).font = { bold: true };
          }
        }
        
        // Generate buffer
        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `clients-export-${timestamp}.xlsx`;
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
    console.error('Error exporting clients:', error);
    return NextResponse.json(
      { error: 'Failed to export clients' },
      { status: 500 }
    );
  }
}

// Helper function to generate clients summary
function generateClientsSummary(clientsData: any[]): any[] {
  const totalClients = clientsData.length;
  const activeClients = clientsData.filter(client => client.isActive).length;
  const inactiveClients = totalClients - activeClients;
  const totalOrders = clientsData.reduce((sum, client) => sum + client.totalOrders, 0);
  const totalSpent = clientsData.reduce((sum, client) => sum + (client.totalSpent || 0), 0);
  const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
  
  return [
    {
      metric: 'Total Clients',
      value: totalClients,
      currency: 'count'
    },
    {
      metric: 'Active Clients',
      value: activeClients,
      currency: 'count'
    },
    {
      metric: 'Inactive Clients',
      value: inactiveClients,
      currency: 'count'
    },
    {
      metric: 'Total Orders',
      value: totalOrders,
      currency: 'count'
    },
    {
      metric: 'Total Revenue',
      value: totalSpent,
      currency: 'USD'
    },
    {
      metric: 'Average Order Value',
      value: averageOrderValue,
      currency: 'USD'
    },
    {
      metric: 'Active Rate',
      value: totalClients > 0 ? (activeClients / totalClients) * 100 : 0,
      currency: 'percentage'
    }
  ];
}
