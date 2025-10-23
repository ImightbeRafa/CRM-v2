/**
 * Selective Database Cleanup Script
 * 
 * This script lets you choose which data to keep or delete.
 * Useful for cleaning test data while keeping real production data.
 * 
 * Usage:
 *   node scripts/clean-database-selective.js
 */

const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🧹 SELECTIVE DATABASE CLEANUP');
  console.log('='.repeat(60) + '\n');
  
  console.log('Choose what to delete:\n');
  
  const deleteOrders = await askQuestion('Delete all Orders? (y/n): ');
  const deleteClients = await askQuestion('Delete all Clients (frequent customers)? (y/n): ');
  const deleteInventory = await askQuestion('Delete all Inventory Items? (y/n): ');
  const deleteInvoices = await askQuestion('Delete all Invoices? (y/n): ');
  const deleteAudit = await askQuestion('Delete all Audit Logs? (y/n): ');
  const deleteUsers = await askQuestion('Delete all Users (except OWNER)? (y/n): ');
  const deleteConfig = await askQuestion('Delete all Config (fields, options, shipping, sellers)? (y/n): ');
  
  console.log('\n' + '='.repeat(60));
  console.log('CONFIRMATION');
  console.log('='.repeat(60));
  console.log('\nYou chose to delete:');
  if (deleteOrders === 'y') console.log('  ✓ Orders');
  if (deleteClients === 'y') console.log('  ✓ Clients');
  if (deleteInventory === 'y') console.log('  ✓ Inventory');
  if (deleteInvoices === 'y') console.log('  ✓ Invoices');
  if (deleteAudit === 'y') console.log('  ✓ Audit Logs');
  if (deleteUsers === 'y') console.log('  ✓ Users (except OWNER)');
  if (deleteConfig === 'y') console.log('  ✓ Configuration data');
  
  const confirm = await askQuestion('\n⚠️  Proceed with deletion? (yes/no): ');
  
  if (confirm.toLowerCase() !== 'yes') {
    console.log('\n❌ Cleanup cancelled.\n');
    rl.close();
    await prisma.$disconnect();
    return;
  }
  
  console.log('\n🗑️  Starting selective cleanup...\n');
  
  let totalDeleted = 0;
  
  try {
    if (deleteAudit === 'y') {
      console.log('⏳ Deleting AuditLog...');
      const count = await prisma.auditLog.deleteMany({});
      console.log(`✅ Deleted ${count.count} audit logs`);
      totalDeleted += count.count;
    }
    
    if (deleteInvoices === 'y') {
      console.log('⏳ Deleting Invoices...');
      const count = await prisma.invoice.deleteMany({});
      console.log(`✅ Deleted ${count.count} invoices`);
      totalDeleted += count.count;
    }
    
    if (deleteOrders === 'y') {
      console.log('⏳ Deleting Orders...');
      const count = await prisma.order.deleteMany({});
      console.log(`✅ Deleted ${count.count} orders`);
      totalDeleted += count.count;
    }
    
    if (deleteClients === 'y') {
      console.log('⏳ Deleting Clients...');
      const count = await prisma.client.deleteMany({});
      console.log(`✅ Deleted ${count.count} clients`);
      totalDeleted += count.count;
    }
    
    if (deleteInventory === 'y') {
      console.log('⏳ Deleting Inventory Items...');
      const count = await prisma.inventoryItem.deleteMany({});
      console.log(`✅ Deleted ${count.count} inventory items`);
      totalDeleted += count.count;
    }
    
    if (deleteConfig === 'y') {
      console.log('⏳ Deleting Product Fields...');
      const fieldCount = await prisma.productField.deleteMany({});
      console.log(`✅ Deleted ${fieldCount.count} product fields`);
      totalDeleted += fieldCount.count;
      
      console.log('⏳ Deleting Product Option Sets...');
      const optionCount = await prisma.productOptionSet.deleteMany({});
      console.log(`✅ Deleted ${optionCount.count} option sets`);
      totalDeleted += optionCount.count;
      
      console.log('⏳ Deleting Shipping Methods...');
      const shippingCount = await prisma.shippingMethod.deleteMany({});
      console.log(`✅ Deleted ${shippingCount.count} shipping methods`);
      totalDeleted += shippingCount.count;
      
      console.log('⏳ Deleting Sellers...');
      const sellerCount = await prisma.seller.deleteMany({});
      console.log(`✅ Deleted ${sellerCount.count} sellers`);
      totalDeleted += sellerCount.count;
    }
    
    if (deleteUsers === 'y') {
      console.log('⏳ Deleting non-OWNER memberships...');
      const membershipCount = await prisma.membership.deleteMany({
        where: { role: { not: 'OWNER' } }
      });
      console.log(`✅ Deleted ${membershipCount.count} memberships`);
      totalDeleted += membershipCount.count;
      
      console.log('⏳ Deleting non-OWNER users...');
      // Get all OWNER user IDs
      const ownerMemberships = await prisma.membership.findMany({
        where: { role: 'OWNER' },
        select: { userId: true }
      });
      const ownerUserIds = ownerMemberships.map(m => m.userId);
      
      const userCount = await prisma.user.deleteMany({
        where: { id: { notIn: ownerUserIds } }
      });
      console.log(`✅ Deleted ${userCount.count} non-OWNER users`);
      totalDeleted += userCount.count;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SELECTIVE CLEANUP COMPLETE!');
    console.log('='.repeat(60));
    console.log(`\n📊 Total Records Deleted: ${totalDeleted}`);
    console.log('\n🎉 Your database has been cleaned!\n');
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:');
    console.error(error.message);
    console.error('\n💡 Tip: Make sure your database connection is working.');
  }
  
  rl.close();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  rl.close();
  await prisma.$disconnect();
  process.exit(1);
});

