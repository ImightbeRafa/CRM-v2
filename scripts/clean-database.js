/**
 * Database Cleanup Script
 * 
 * ⚠️ WARNING: This script will DELETE ALL DATA from your database!
 * Use with extreme caution. Only run this on development or before production launch.
 * 
 * Usage:
 *   node scripts/clean-database.js
 * 
 * To confirm deletion, you'll be prompted to type 'DELETE ALL DATA'
 */

const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function cleanDatabase() {
  console.log('\n' + '='.repeat(60));
  console.log('🧹 DATABASE CLEANUP SCRIPT');
  console.log('='.repeat(60) + '\n');
  
  console.log('⚠️  WARNING: This will DELETE ALL DATA from your database!');
  console.log('📊 Database:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'Unknown');
  console.log('\nTables that will be cleared:');
  console.log('  - AuditLog');
  console.log('  - Invoice');
  console.log('  - Order');
  console.log('  - BillingTransaction');
  console.log('  - UsageLog');
  console.log('  - Client');
  console.log('  - InventoryItem');
  console.log('  - ProductField');
  console.log('  - ProductOptionSet');
  console.log('  - ShippingMethod');
  console.log('  - Seller');
  console.log('  - Membership');
  console.log('  - User');
  console.log('  - Tenant');
  console.log('\n' + '='.repeat(60));
  
  return new Promise((resolve) => {
    rl.question('\n❓ Type "DELETE ALL DATA" to confirm deletion: ', (answer) => {
      rl.close();
      resolve(answer === 'DELETE ALL DATA');
    });
  });
}

async function deleteAllData() {
  console.log('\n🗑️  Starting database cleanup...\n');
  
  try {
    // Delete in order of dependencies (child tables first)
    
    console.log('⏳ Deleting AuditLog...');
    const auditCount = await prisma.auditLog.deleteMany({});
    console.log(`✅ Deleted ${auditCount.count} audit logs`);
    
    console.log('⏳ Deleting Invoice...');
    const invoiceCount = await prisma.invoice.deleteMany({});
    console.log(`✅ Deleted ${invoiceCount.count} invoices`);
    
    console.log('⏳ Deleting Order...');
    const orderCount = await prisma.order.deleteMany({});
    console.log(`✅ Deleted ${orderCount.count} orders`);
    
    console.log('⏳ Deleting BillingTransaction...');
    const billingCount = await prisma.billingTransaction.deleteMany({});
    console.log(`✅ Deleted ${billingCount.count} billing transactions`);
    
    console.log('⏳ Deleting UsageLog...');
    const usageCount = await prisma.usageLog.deleteMany({});
    console.log(`✅ Deleted ${usageCount.count} usage logs`);
    
    console.log('⏳ Deleting Client...');
    const clientCount = await prisma.client.deleteMany({});
    console.log(`✅ Deleted ${clientCount.count} clients`);
    
    console.log('⏳ Deleting InventoryItem...');
    const inventoryCount = await prisma.inventoryItem.deleteMany({});
    console.log(`✅ Deleted ${inventoryCount.count} inventory items`);
    
    console.log('⏳ Deleting ProductField...');
    const fieldCount = await prisma.productField.deleteMany({});
    console.log(`✅ Deleted ${fieldCount.count} product fields`);
    
    console.log('⏳ Deleting ProductOptionSet...');
    const optionCount = await prisma.productOptionSet.deleteMany({});
    console.log(`✅ Deleted ${optionCount.count} product option sets`);
    
    console.log('⏳ Deleting ShippingMethod...');
    const shippingCount = await prisma.shippingMethod.deleteMany({});
    console.log(`✅ Deleted ${shippingCount.count} shipping methods`);
    
    console.log('⏳ Deleting Seller...');
    const sellerCount = await prisma.seller.deleteMany({});
    console.log(`✅ Deleted ${sellerCount.count} sellers`);
    
    console.log('⏳ Deleting Membership...');
    const membershipCount = await prisma.membership.deleteMany({});
    console.log(`✅ Deleted ${membershipCount.count} memberships`);
    
    console.log('⏳ Deleting User...');
    const userCount = await prisma.user.deleteMany({});
    console.log(`✅ Deleted ${userCount.count} users`);
    
    console.log('⏳ Deleting Tenant...');
    const tenantCount = await prisma.tenant.deleteMany({});
    console.log(`✅ Deleted ${tenantCount.count} tenants`);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ DATABASE CLEANUP COMPLETE!');
    console.log('='.repeat(60));
    console.log('\n📊 Summary:');
    console.log(`   Tenants: ${tenantCount.count}`);
    console.log(`   Users: ${userCount.count}`);
    console.log(`   Memberships: ${membershipCount.count}`);
    console.log(`   Orders: ${orderCount.count}`);
    console.log(`   Clients: ${clientCount.count}`);
    console.log(`   Inventory: ${inventoryCount.count}`);
    console.log(`   Invoices: ${invoiceCount.count}`);
    console.log(`   Audit Logs: ${auditCount.count}`);
    console.log(`   Total Records Deleted: ${
      auditCount.count + 
      invoiceCount.count + 
      orderCount.count + 
      billingCount.count + 
      usageCount.count + 
      clientCount.count + 
      inventoryCount.count + 
      fieldCount.count + 
      optionCount.count + 
      shippingCount.count + 
      sellerCount.count + 
      membershipCount.count + 
      userCount.count + 
      tenantCount.count
    }`);
    console.log('\n🎉 Your database is now clean and ready for production!');
    console.log('💡 Tip: First user to sign up will create a new tenant.\n');
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:');
    console.error(error.message);
    console.error('\n💡 Tip: Make sure your database connection is working.');
    process.exit(1);
  }
}

async function main() {
  const confirmed = await cleanDatabase();
  
  if (!confirmed) {
    console.log('\n❌ Cleanup cancelled. No data was deleted.\n');
    await prisma.$disconnect();
    process.exit(0);
  }
  
  await deleteAllData();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
