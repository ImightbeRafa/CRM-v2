/**
 * Database Statistics Script
 * 
 * Shows how many records are in each table.
 * Safe to run - does not modify data.
 * 
 * Usage:
 *   node scripts/check-database-stats.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function getStats() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 DATABASE STATISTICS');
  console.log('='.repeat(60) + '\n');
  
  try {
    const tenantCount = await prisma.tenant.count();
    const userCount = await prisma.user.count();
    const membershipCount = await prisma.membership.count();
    const orderCount = await prisma.order.count();
    const clientCount = await prisma.client.count();
    const inventoryCount = await prisma.inventoryItem.count();
    const invoiceCount = await prisma.invoice.count();
    const auditCount = await prisma.auditLog.count();
    const billingCount = await prisma.billingTransaction.count();
    const usageCount = await prisma.usageLog.count();
    const fieldCount = await prisma.productField.count();
    const optionCount = await prisma.productOptionSet.count();
    const shippingCount = await prisma.shippingMethod.count();
    const sellerCount = await prisma.seller.count();
    
    console.log('Core Data:');
    console.log(`  Tenants:              ${tenantCount.toString().padStart(6)}`);
    console.log(`  Users:                ${userCount.toString().padStart(6)}`);
    console.log(`  Memberships:          ${membershipCount.toString().padStart(6)}`);
    
    console.log('\nBusiness Data:');
    console.log(`  Orders:               ${orderCount.toString().padStart(6)}`);
    console.log(`  Clients:              ${clientCount.toString().padStart(6)}`);
    console.log(`  Inventory Items:      ${inventoryCount.toString().padStart(6)}`);
    console.log(`  Invoices:             ${invoiceCount.toString().padStart(6)}`);
    
    console.log('\nConfiguration:');
    console.log(`  Product Fields:       ${fieldCount.toString().padStart(6)}`);
    console.log(`  Product Options:      ${optionCount.toString().padStart(6)}`);
    console.log(`  Shipping Methods:     ${shippingCount.toString().padStart(6)}`);
    console.log(`  Sellers:              ${sellerCount.toString().padStart(6)}`);
    
    console.log('\nSystem Data:');
    console.log(`  Audit Logs:           ${auditCount.toString().padStart(6)}`);
    console.log(`  Billing Records:      ${billingCount.toString().padStart(6)}`);
    console.log(`  Usage Logs:           ${usageCount.toString().padStart(6)}`);
    
    const totalCount = 
      tenantCount + userCount + membershipCount + orderCount + 
      clientCount + inventoryCount + invoiceCount + auditCount + 
      billingCount + usageCount + fieldCount + optionCount + 
      shippingCount + sellerCount;
    
    console.log('\n' + '-'.repeat(60));
    console.log(`  TOTAL RECORDS:        ${totalCount.toString().padStart(6)}`);
    console.log('='.repeat(60));
    
    if (totalCount === 0) {
      console.log('\n✨ Database is clean! No data present.');
    } else {
      console.log(`\n📈 Database contains ${totalCount} records.`);
    }
    
    // Get database info
    console.log('\n📍 Database Info:');
    const dbUrl = process.env.DATABASE_URL || '';
    const dbHost = dbUrl.split('@')[1]?.split('/')[0] || 'Unknown';
    console.log(`   Host: ${dbHost}`);
    console.log(`   Connection: ${dbUrl ? 'Connected' : 'Not configured'}`);
    
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Error getting statistics:');
    console.error(error.message);
    console.error('\n💡 Tip: Make sure your database connection is working.');
  }
}

async function main() {
  await getStats();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  await prisma.$disconnect();
  process.exit(1);
});

