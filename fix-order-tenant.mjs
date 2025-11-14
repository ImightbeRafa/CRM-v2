/**
 * Script to fix orders with wrong tenant ID
 * 
 * Usage:
 *   node fix-order-tenant.mjs
 * 
 * This will move the specified orders to the correct tenant
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration
const WRONG_TENANT_ID = 'cmh32z0ol0000k004hvx9tg3p';
const CORRECT_TENANT_ID = 'cmhsibjue0004js04gie724nx';
const ORDER_IDS = [
  'ORDER-1763161425190',  // Alexander Valverde Cordero
  'ORDER-1763162035513'   // Isaac Molina Chorres
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
        timestamp: true
      }
    });
    
    if (orders.length === 0) {
      console.error('❌ No orders found with the specified IDs');
      process.exit(1);
    }
    
    console.log(`✅ Found ${orders.length} order(s):\n`);
    orders.forEach((order, idx) => {
      console.log(`  ${idx + 1}. ${order.orderId}`);
      console.log(`     Customer: ${order.customerName}`);
      console.log(`     Current Tenant: ${order.tenantId}`);
      console.log(`     Status: ${order.status}`);
      console.log(`     Date: ${order.timestamp}\n`);
    });
    
    // Step 2: Verify wrong tenant
    const wrongTenantOrders = orders.filter(o => o.tenantId === WRONG_TENANT_ID);
    if (wrongTenantOrders.length === 0) {
      console.log('✅ All orders are already in the correct tenant!');
      return;
    }
    
    console.log(`⚠️  Found ${wrongTenantOrders.length} order(s) in wrong tenant\n`);
    
    // Step 3: Verify target tenant exists
    console.log('📋 Step 2: Verifying target tenant exists...');
    const targetTenant = await prisma.tenant.findUnique({
      where: { id: CORRECT_TENANT_ID },
      select: {
        id: true,
        name: true,
        slug: true
      }
    });
    
    if (!targetTenant) {
      console.error(`❌ Target tenant not found: ${CORRECT_TENANT_ID}`);
      process.exit(1);
    }
    
    console.log(`✅ Target tenant found: ${targetTenant.name} (${targetTenant.slug})\n`);
    
    // Step 4: Update orders
    console.log('📋 Step 3: Updating order tenants...');
    const result = await prisma.order.updateMany({
      where: {
        orderId: { in: ORDER_IDS },
        tenantId: WRONG_TENANT_ID
      },
      data: {
        tenantId: CORRECT_TENANT_ID
      }
    });
    
    console.log(`✅ Updated ${result.count} order(s)\n`);
    
    // Step 5: Verify the update
    console.log('📋 Step 4: Verifying update...');
    const updatedOrders = await prisma.order.findMany({
      where: {
        orderId: { in: ORDER_IDS }
      },
      select: {
        orderId: true,
        customerName: true,
        tenantId: true
      }
    });
    
    console.log('✅ Final state:\n');
    updatedOrders.forEach((order, idx) => {
      const isCorrect = order.tenantId === CORRECT_TENANT_ID;
      const icon = isCorrect ? '✅' : '❌';
      console.log(`  ${icon} ${order.orderId}`);
      console.log(`     Customer: ${order.customerName}`);
      console.log(`     Tenant: ${order.tenantId}`);
      console.log(`     Status: ${isCorrect ? 'CORRECT' : 'STILL WRONG'}\n`);
    });
    
    const allCorrect = updatedOrders.every(o => o.tenantId === CORRECT_TENANT_ID);
    if (allCorrect) {
      console.log('🎉 SUCCESS! All orders have been moved to the correct tenant.\n');
      console.log('Next steps:');
      console.log('  1. Log into Rafael Garcia\'s account');
      console.log('  2. Clear browser cache: localStorage.removeItem(\'salesCache\')');
      console.log('  3. Refresh the dashboard');
      console.log('  4. Orders will now appear!\n');
    } else {
      console.error('⚠️  Some orders may still be in the wrong tenant. Please review.\n');
    }
    
  } catch (error) {
    console.error('❌ Error fixing order tenants:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║         Order Tenant Fix Script                       ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

fixOrderTenants()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
