import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { put, list, del } from '@vercel/blob';

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const url = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const qpSecret = url.searchParams.get('secret');
    
    if (!cronSecret) {
      console.error('❌ CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      );
    }
    
    if (authHeader !== `Bearer ${cronSecret}` && qpSecret !== cronSecret) {
      console.error('❌ Invalid cron authorization');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🔄 Starting automated backup...');
    const result = await performBackup('auto');
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Automated backup failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Backup failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Allow POST requests as well (for manual triggers)
export async function POST(request: NextRequest) {
  try {
    // For POST requests, we can add additional authentication
    // or allow manual triggers with proper API key
    
    const apiKey = request.headers.get('x-api-key');
    const expectedApiKey = process.env.BACKUP_API_KEY;
    
    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    console.log('🔄 Starting manual backup...');
    const result = await performBackup('manual');
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Manual backup failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Manual backup failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

type BackupMode = 'auto' | 'manual';

async function performBackup(mode: BackupMode) {
  const startedAt = new Date();
  const prisma = new PrismaClient({ log: ['error', 'warn'], datasourceUrl: process.env.DATABASE_URL });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = `betsy/backups/${ts}`;

  const manifest: any = {
    mode,
    startedAt: startedAt.toISOString(),
    files: [] as Array<{ name: string; url: string; size: number }>,
    counts: {} as Record<string, number>,
  };

  try {
    const upload = async (name: string, data: unknown) => {
      const body = JSON.stringify(data);
      const res = await put(
        `${basePath}/${name}`,
        body,
        { access: 'public', contentType: 'application/json', token: token || undefined } as any
      );
      manifest.files.push({ name, url: res.url, size: body.length });
      return res.url;
    };

    const fetchPaged = async <T extends { id: string }>(fetcher: (args: any) => Promise<T[]>, take = 5000, cap = 50000) => {
      let cursor: string | null = null;
      const out: T[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const args: any = { take, orderBy: { id: 'asc' } };
        if (cursor) { args.skip = 1; args.cursor = { id: cursor }; }
        const page = await fetcher(args);
        if (!page.length) break;
        out.push(...page);
        cursor = page[page.length - 1].id;
        if (out.length >= cap) break;
      }
      return out;
    };

    const tenants = await fetchPaged((args) => prisma.tenant.findMany(args));
    manifest.counts.tenants = tenants.length;
    await upload('tenants.json', tenants);

    const users = await fetchPaged((args) => prisma.user.findMany(args));
    manifest.counts.users = users.length;
    await upload('users.json', users);

    const memberships = await fetchPaged((args) => prisma.membership.findMany(args));
    manifest.counts.memberships = memberships.length;
    await upload('memberships.json', memberships);

    const orders = await fetchPaged((args) => prisma.order.findMany(args));
    manifest.counts.orders = orders.length;
    await upload('orders.json', orders);

    const clients = await fetchPaged((args) => prisma.client.findMany(args));
    manifest.counts.clients = clients.length;
    await upload('clients.json', clients);

    const items = await fetchPaged((args) => prisma.inventoryItem.findMany(args));
    manifest.counts.inventoryItems = items.length;
    await upload('inventory-items.json', items);

    const invoices = await fetchPaged((args) => prisma.invoice.findMany(args));
    manifest.counts.invoices = invoices.length;
    await upload('invoices.json', invoices);

    const txs = await fetchPaged((args) => prisma.billingTransaction.findMany(args));
    manifest.counts.billingTransactions = txs.length;
    await upload('billing-transactions.json', txs);

    const sellers = await fetchPaged((args) => prisma.seller.findMany(args));
    manifest.counts.sellers = sellers.length;
    await upload('sellers.json', sellers);

    const shippingMethods = await fetchPaged((args) => prisma.shippingMethod.findMany(args));
    manifest.counts.shippingMethods = shippingMethods.length;
    await upload('shipping-methods.json', shippingMethods);

    const shippingConfigs = await fetchPaged((args) => prisma.shippingConfig.findMany(args));
    manifest.counts.shippingConfigs = shippingConfigs.length;
    await upload('shipping-configs.json', shippingConfigs);

    const shippingGuias = await fetchPaged((args) => prisma.shippingGuia.findMany(args));
    manifest.counts.shippingGuias = shippingGuias.length;
    await upload('shipping-guias.json', shippingGuias);

    const productFields = await fetchPaged((args) => prisma.productField.findMany(args));
    manifest.counts.productFields = productFields.length;
    await upload('product-fields.json', productFields);

    const productOptionSets = await fetchPaged((args) => prisma.productOptionSet.findMany(args));
    manifest.counts.productOptionSets = productOptionSets.length;
    await upload('product-option-sets.json', productOptionSets);

    const productOptions = await fetchPaged((args) => prisma.productOption.findMany(args));
    manifest.counts.productOptions = productOptions.length;
    await upload('product-options.json', productOptions);

    const businessInfos = await fetchPaged((args) => prisma.businessInfo.findMany(args));
    manifest.counts.businessInfos = businessInfos.length;
    await upload('business-info.json', businessInfos);

    const orderStatuses = await fetchPaged((args) => prisma.orderStatus.findMany(args));
    manifest.counts.orderStatuses = orderStatuses.length;
    await upload('order-statuses.json', orderStatuses);

    const auditLogs = await fetchPaged((args) => prisma.auditLog.findMany(args));
    manifest.counts.auditLogs = auditLogs.length;
    await upload('audit-logs.json', auditLogs);

    const usageLogs = await fetchPaged((args) => prisma.usageLog.findMany(args));
    manifest.counts.usageLogs = usageLogs.length;
    await upload('usage-logs.json', usageLogs);

    const webhookLogs = await fetchPaged((args) => prisma.webhookLog.findMany(args));
    manifest.counts.webhookLogs = webhookLogs.length;
    await upload('webhook-logs.json', webhookLogs);

    await upload('manifest.json', manifest);

    await prisma.$disconnect();

    const response = {
      success: true,
      message: 'Backup completed successfully',
      timestamp: new Date().toISOString(),
      manifest,
    };

    // Optional retention cleanup
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '0', 10);
    if (!Number.isNaN(retentionDays) && retentionDays > 0) {
      try {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        let cursor: string | undefined = undefined;
        const prefix = 'betsy/backups/';
        const groups = new Map<string, { urls: string[]; latest: number }>();
        do {
          const res: any = await list({ prefix, token: process.env.BLOB_READ_WRITE_TOKEN, cursor } as any);
          for (const b of res.blobs || []) {
            const pathname: string = b.pathname || '';
            const parts = pathname.split('/');
            if (parts.length < 3) continue; // betsy/backups/<dir>/<file>
            const dir = parts.slice(0, 3).join('/');
            const uploaded = new Date(b.uploadedAt || b.uploaded_at || b.createdAt || Date.now()).getTime();
            const arr = groups.get(dir) || { urls: [], latest: 0 };
            arr.urls.push(b.url);
            arr.latest = Math.max(arr.latest, uploaded);
            groups.set(dir, arr);
          }
          cursor = res.hasMore ? res.cursor : undefined;
        } while (cursor);

        const toDelete: string[] = [];
        for (const [dir, info] of groups) {
          if (info.latest < cutoff) {
            toDelete.push(...info.urls);
          }
        }
        if (toDelete.length) {
          await del(toDelete as any, { token: process.env.BLOB_READ_WRITE_TOKEN } as any);
          (response as any).retention = { deletedFiles: toDelete.length, cutoff: new Date(cutoff).toISOString() };
        }
      } catch (retErr) {
        console.warn('⚠️ Retention cleanup skipped/failed:', retErr);
      }
    }

    return response;
  } catch (err) {
    try { await prisma.$disconnect(); } catch {}
    throw err;
  }
}