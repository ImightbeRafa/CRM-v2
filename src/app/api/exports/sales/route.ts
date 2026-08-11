import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_sales');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const groupBy = searchParams.get('groupBy') || 'day';

    if (!['json', 'csv', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx' },
        { status: 400 }
      );
    }

    const prisma = getTenantPrisma(auth.tenantId);
    const whereClause: any = {};

    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) whereClause.timestamp.gte = new Date(startDate);
      if (endDate) whereClause.timestamp.lte = new Date(endDate);
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' },
      take: 10000,
    });

    const salesData = orders.map(order => {
      const orderDate = new Date(order.timestamp);

      return {
        id: order.id,
        orderNumber: order.orderId,
        date: getDateKey(orderDate, groupBy),
        status: order.status,
        orderType: order.orderType,
        total: order.total,
        clientName: order.customerName || 'N/A',
        clientEmail: order.email || 'N/A',
        clientPhone: order.phone || 'N/A',
        sellerName: order.seller || order.username || 'N/A',
        product: order.product || 'N/A',
        quantity: order.quantity,
        productCost: order.productCost || 0,
        shippingCost: order.shippingCost || 0,
        iva: order.iva || 0,
        createdAt: order.timestamp.toISOString(),
      };
    });

    const exportData = groupBy === 'none' ? salesData : groupSalesByDate(salesData);
    const timestamp = new Date().toISOString().split('T')[0];

    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;

    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `sales-export-${timestamp}.json`;
        break;

      case 'csv': {
        const csvParser = new Parser();
        exportContent = csvParser.parse(exportData);
        contentType = 'text/csv';
        filename = `sales-export-${timestamp}.csv`;
        break;
      }

      case 'xlsx': {
        const workbook = new ExcelJS.Workbook();
        addJsonSheet(workbook, 'Sales', exportData);
        addJsonSheet(workbook, 'Summary', generateSalesSummary(salesData));
        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `sales-export-${timestamp}.xlsx`;
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
    console.error('Error exporting sales:', error);
    return NextResponse.json(
      { error: 'Failed to export sales' },
      { status: 500 }
    );
  }
}

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

function groupSalesByDate(salesData: any[]): any[] {
  const grouped = salesData.reduce((acc, sale) => {
    const key = sale.date;
    if (!acc[key]) {
      acc[key] = {
        date: key,
        totalSales: 0,
        ordersCount: 0,
        clientsCount: new Set<string>(),
        sellersCount: new Set<string>(),
        itemsCount: 0,
      };
    }

    acc[key].totalSales += sale.total;
    acc[key].ordersCount += 1;
    acc[key].clientsCount.add(sale.clientName);
    acc[key].sellersCount.add(sale.sellerName);
    acc[key].itemsCount += sale.quantity || 0;

    return acc;
  }, {} as Record<string, any>);

  return Object.values(grouped).map((group: any) => ({
    date: group.date,
    totalSales: group.totalSales,
    ordersCount: group.ordersCount,
    clientsCount: group.clientsCount.size,
    sellersCount: group.sellersCount.size,
    itemsCount: group.itemsCount,
    averageOrderValue: group.ordersCount > 0 ? group.totalSales / group.ordersCount : 0,
  }));
}

function generateSalesSummary(salesData: any[]): any[] {
  const totalSales = salesData.reduce((sum, sale) => sum + sale.total, 0);
  const totalOrders = salesData.length;
  const uniqueClients = new Set(salesData.map(sale => sale.clientName)).size;
  const uniqueSellers = new Set(salesData.map(sale => sale.sellerName)).size;
  const totalItems = salesData.reduce((sum, sale) => sum + (sale.quantity || 0), 0);

  return [
    { metric: 'Total Sales', value: totalSales, currency: 'CRC' },
    { metric: 'Total Orders', value: totalOrders, currency: 'count' },
    { metric: 'Unique Clients', value: uniqueClients, currency: 'count' },
    { metric: 'Unique Sellers', value: uniqueSellers, currency: 'count' },
    { metric: 'Total Items', value: totalItems, currency: 'count' },
    {
      metric: 'Average Order Value',
      value: totalOrders > 0 ? totalSales / totalOrders : 0,
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
