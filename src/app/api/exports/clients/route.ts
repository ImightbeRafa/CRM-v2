import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import { neutralizeCsvFormula, PII_NO_STORE_HEADERS } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_sales');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const includeOrders = searchParams.get('includeOrders') === 'true';
    const includeStats = searchParams.get('includeStats') === 'true';

    if (!['json', 'csv', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx' },
        { status: 400 }
      );
    }

    const prisma = getTenantPrisma(auth.tenantId);
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      take: 10000,
    });

    const clientOrderFilters = clients.flatMap(client => ([
      { phone: client.phone },
      { customerName: client.name },
    ]));

    const clientOrders = includeOrders && clientOrderFilters.length > 0
      ? await prisma.order.findMany({
          where: {
            OR: clientOrderFilters,
          },
          orderBy: { timestamp: 'desc' },
          take: 10000,
        })
      : [];

    const ordersByClient = new Map<string, typeof clientOrders>();
    if (includeOrders) {
      for (const client of clients) {
        ordersByClient.set(
          client.id,
          clientOrders.filter(order => order.phone === client.phone || order.customerName === client.name)
        );
      }
    }

    const exportData = clients.map(client => {
      const baseData: any = {
        id: client.id,
        name: neutralizeCsvFormula(client.name),
        email: neutralizeCsvFormula(client.email),
        phone: neutralizeCsvFormula(client.phone),
        province: neutralizeCsvFormula(client.province),
        canton: neutralizeCsvFormula(client.canton),
        district: neutralizeCsvFormula(client.district),
        address: neutralizeCsvFormula(client.address),
        business: neutralizeCsvFormula(client.business),
        username: neutralizeCsvFormula(client.username),
        isActive: client.isActive,
        isFavorite: client.isFavorite,
        totalOrders: client.totalOrders,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.lastUpdated.toISOString(),
      };

      if (includeStats) {
        baseData.totalSpent = client.totalSpent;
        baseData.averageOrderValue = client.averageOrderValue;
        baseData.firstOrderDate = client.firstOrder.toISOString();
        baseData.lastOrderDate = client.lastOrder.toISOString();
      }

      if (includeOrders) {
        baseData.orders = (ordersByClient.get(client.id) || []).map(order => ({
          orderNumber: order.orderId,
          status: order.status,
          total: order.total,
          createdAt: order.timestamp.toISOString(),
        }));
      }

      return baseData;
    });

    const timestamp = new Date().toISOString().split('T')[0];
    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;

    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `clients-export-${timestamp}.json`;
        break;

      case 'csv': {
        const flattenedData = exportData.map(({ orders, ...client }) => client);
        const csvParser = new Parser();
        exportContent = csvParser.parse(flattenedData);
        contentType = 'text/csv';
        filename = `clients-export-${timestamp}.csv`;
        break;
      }

      case 'xlsx': {
        const workbook = new ExcelJS.Workbook();
        addJsonSheet(workbook, 'Clients', exportData.map(({ orders, ...client }) => client));

        if (includeOrders) {
          const allOrders = exportData.flatMap(client =>
            (client.orders || []).map((order: any) => ({
              clientName: client.name,
              clientEmail: client.email,
              clientPhone: client.phone,
              ...order,
            }))
          );
          addJsonSheet(workbook, 'Orders', allOrders);
        }

        addJsonSheet(workbook, 'Summary', generateClientsSummary(exportData));
        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `clients-export-${timestamp}.xlsx`;
        break;
      }

      default:
        throw new Error('Unsupported format');
    }

    return new NextResponse(exportContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportContent.length.toString(),
        ...PII_NO_STORE_HEADERS,
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

function generateClientsSummary(clientsData: any[]): any[] {
  const totalClients = clientsData.length;
  const activeClients = clientsData.filter(client => client.isActive).length;
  const totalOrders = clientsData.reduce((sum, client) => sum + (client.totalOrders || 0), 0);
  const totalSpent = clientsData.reduce((sum, client) => sum + (client.totalSpent || 0), 0);

  return [
    { metric: 'Total Clients', value: totalClients, currency: 'count' },
    { metric: 'Active Clients', value: activeClients, currency: 'count' },
    { metric: 'Inactive Clients', value: totalClients - activeClients, currency: 'count' },
    { metric: 'Total Orders', value: totalOrders, currency: 'count' },
    { metric: 'Total Revenue', value: totalSpent, currency: 'CRC' },
    {
      metric: 'Average Order Value',
      value: totalOrders > 0 ? totalSpent / totalOrders : 0,
      currency: 'CRC',
    },
  ];
}

function addJsonSheet(workbook: ExcelJS.Workbook, name: string, data: any[]) {
  const worksheet = workbook.addWorksheet(name);
  if (data.length === 0) return;

  worksheet.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 18 }));
  data.forEach(row => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
}
