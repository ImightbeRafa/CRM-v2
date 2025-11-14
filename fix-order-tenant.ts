/**
 * TypeScript Script to fix orders with wrong tenant ID
 * 
 * Usage:
 *   npx tsx fix-order-tenant.ts
 *   OR
 *   npx ts-node fix-order-tenant.ts
 * 
 * This will move the specified orders to the correct tenant
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration - UPDATE THESE VALUES
const WRONG_TENANT_ID = 'cmh32z0ol0000k004hvx9tg3p';
const CORRECT_TENANT_ID = 'cmhsibjue0004js04gie724nx'; // Rafael Garcia's Organization
const ORDER_IDS = [
  'ORDER-1763161425190',  // Alexander Valverde Cordero - Bucal x1 - ₡9,900
  'ORDER-1763162035513',  // Isaac Molina Chorres - Bucal x2 - ₡19,800
  'ORDER-1763162365759'   // José Ángel Zamora Mejias (add if needed)
];

async function fixOrderTenants() {
  try {
    console.log('🔧 Starting order tenant fix...\n');
    
    // Step 1: Verify orders exist
    console.log('📋 Step 1: Verifying orders exist...');
    const orders = await prisma.order.findMany({
      where: {
        orderId: { in: ORDER_IDS }
      },
      select: {
        id: true,
        orderId: true,
        customerName: true,
        tenantId: true,
        status: true,
        total: true,
        product: true,
        quantity: true,
        timestamp: true
      }
    });
    
    if (orders.length === 0) {
      console.error('❌ No orders found with the specified IDs');
      console.log('Available order IDs in wrong tenant:');
      const wrongTenantOrders = await prisma.order.findMany({
        where: { tenantId: WRONG_TENANT_ID },
        select: { orderId: true, customerName: true },
        take: 10,
        orderBy: { timestamp: 'desc' }
      });
      wrongTenantOrders.forEach(o => console.log(`  - ${o.orderId} (${o.customerName})`));
      process.exit(1);
    }
    
    console.log(`✅ Found ${orders.length} order(s):\n`);
    orders.forEach((order, idx) => {
      console.log(`  ${idx + 1}. ${order.orderId}`);
      console.log(`     Customer: ${order.customerName}`);
      console.log(`     Product: ${order.product} x${order.quantity}`);
      console.log(`     Total: ₡${order.total.toLocaleString()}`);
      console.log(`     Current Tenant: ${order.tenantId}`);
      console.log(`     Status: ${order.status}`);
      console.log(`     Date: ${new Date(order.timestamp).toLocaleString()}\n`);
    });
    
    // Step 2: Check which orders need fixing
    const wrongTenantOrders = orders.filter(o => o.tenantId === WRONG_TENANT_ID);
    const correctTenantOrders = orders.filter(o => o.tenantId === CORRECT_TENANT_ID);
    
    if (wrongTenantOrders.length === 0) {
      console.log('✅ All orders are already in the correct tenant!');
      if (correctTenantOrders.length > 0) {
        console.log(`✅ ${correctTenantOrders.length} order(s) confirmed in correct tenant.\n`);
      }
      return;
    }
    
    console.log(`⚠️  Found ${wrongTenantOrders.length} order(s) in wrong tenant`);
    if (correctTenantOrders.length > 0) {
      console.log(`✅ ${correctTenantOrders.length} order(s) already in correct tenant`);
    }
    console.log('');
    
    // Step 3: Verify target tenant exists
    console.log('📋 Step 2: Verifying target tenant exists...');
    const targetTenant = await prisma.tenant.findUnique({
      where: { id: CORRECT_TENANT_ID },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true
      }
    });
    
    if (!targetTenant) {
      console.error(`❌ Target tenant not found: ${CORRECT_TENANT_ID}`);
      process.exit(1);
    }
    
    console.log(`✅ Target tenant: ${targetTenant.name}`);
    console.log(`   Slug: ${targetTenant.slug}`);
    console.log(`   Plan: ${targetTenant.plan}\n`);
    
    // Step 4: Show what will be updated
    console.log('📋 Step 3: Orders to be moved:\n');
    wrongTenantOrders.forEach((order, idx) => {
      console.log(`  ${idx + 1}. ${order.orderId} - ${order.customerName}`);
    });
    console.log('');
    
    // Step 5: Update orders
    console.log('🔄 Updating order tenants...');
    const result = await prisma.order.updateMany({
      where: {
        orderId: { in: wrongTenantOrders.map(o => o.orderId) },
        tenantId: WRONG_TENANT_ID
      },
      data: {
        tenantId: CORRECT_TENANT_ID
      }
    });
    
    console.log(`✅ Updated ${result.count} order(s)\n`);
    
    // Step 6: Verify the update
    console.log('📋 Step 4: Verifying update...');
    const updatedOrders = await prisma.order.findMany({
      where: {
        orderId: { in: ORDER_IDS }
      },
      select: {
        orderId: true,
        customerName: true,
        tenantId: true,
        total: true
      }
    });
    
    console.log('✅ Final verification:\n');
    updatedOrders.forEach((order, idx) => {
      const isCorrect = order.tenantId === CORRECT_TENANT_ID;
      const icon = isCorrect ? '✅' : '❌';
      console.log(`  ${icon} ${order.orderId}`);
      console.log(`     Customer: ${order.customerName}`);
      console.log(`     Total: ₡${order.total.toLocaleString()}`);
      console.log(`     Tenant: ${order.tenantId}`);
      console.log(`     Status: ${isCorrect ? 'CORRECT ✅' : 'STILL WRONG ❌'}\n`);
    });
    
    const allCorrect = updatedOrders.every(o => o.tenantId === CORRECT_TENANT_ID);
    
    if (allCorrect) {
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  🎉 SUCCESS! All orders moved to correct tenant       ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      console.log('📝 Next steps:');
      console.log('  1. Log into Rafael Garcia\'s account (cmhsibjue0004js04gie724nx)');
      console.log('  2. Open browser console (F12)');
      console.log('  3. Clear cache: localStorage.removeItem(\'salesCache\')');
      console.log('  4. Refresh the dashboard (Ctrl+Shift+R)');
      console.log('  5. Orders will now appear in produccion! 🚀\n');
      
      const totalAmount = updatedOrders.reduce((sum, o) => sum + Number(o.total), 0);
      console.log(`💰 Total value of moved orders: ₡${totalAmount.toLocaleString()}\n`);
    } else {
      console.error('╔════════════════════════════════════════════════════════╗');
      console.error('║  ⚠️  WARNING: Some orders still in wrong tenant       ║');
      console.error('╚════════════════════════════════════════════════════════╝\n');
      console.log('Please review the output above and try running again.\n');
    }
    
  } catch (error) {
    console.error('\n❌ Error fixing order tenants:');
    console.error(error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║         🔧 Order Tenant Fix Script                    ║');
console.log('║         Betsy CRM - Multi-tenant Order Migration      ║');
console.log('╚════════════════════════════════════════════════════════╝\n');
console.log(`From Tenant: ${WRONG_TENANT_ID}`);
console.log(`To Tenant:   ${CORRECT_TENANT_ID}`);
console.log(`Orders:      ${ORDER_IDS.length} order(s)\n`);

fixOrderTenants()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed');
    process.exit(1);
  });
