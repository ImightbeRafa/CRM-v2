// Clean Database - Remove all data except Tenant, User, Membership
import postgres from 'postgres';

const password = 'p$2?CNkiN96U*Qd';
const connectionString = `postgresql://postgres.bmolvybsqzkeswkomgzw:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;

const sql = postgres(connectionString, {
  ssl: 'require',
  prepare: false,
});

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...\n');
    
    // Get counts before
    const ordersBefore = await sql`SELECT COUNT(*) as count FROM "Order"`;
    const clientsBefore = await sql`SELECT COUNT(*) as count FROM "Client"`;
    const sellersBefore = await sql`SELECT COUNT(*) as count FROM "Seller"`;
    const statusesBefore = await sql`SELECT COUNT(*) as count FROM "OrderStatus"`;
    
    console.log('📊 Before cleanup:');
    console.log(`  • Orders: ${ordersBefore[0].count}`);
    console.log(`  • Clients: ${clientsBefore[0].count}`);
    console.log(`  • Sellers: ${sellersBefore[0].count}`);
    console.log(`  • Statuses: ${statusesBefore[0].count}`);
    console.log('');
    
    // Delete data (keeping structure)
    console.log('🗑️  Deleting data...');
    
    await sql`DELETE FROM "Order"`;
    console.log('  ✓ Orders deleted');
    
    await sql`DELETE FROM "Client"`;
    console.log('  ✓ Clients deleted');
    
    await sql`DELETE FROM "Seller"`;
    console.log('  ✓ Sellers deleted');
    
    await sql`DELETE FROM "OrderStatus"`;
    console.log('  ✓ Order statuses deleted');
    
    await sql`DELETE FROM "ProductField"`;
    console.log('  ✓ Product fields deleted');
    
    await sql`DELETE FROM "ShippingMethod"`;
    console.log('  ✓ Shipping methods deleted');
    
    await sql`DELETE FROM "AuditLog"`;
    console.log('  ✓ Audit logs deleted');
    
    console.log('');
    console.log('✅ Database cleaned!');
    console.log('');
    console.log('📊 Preserved:');
    const tenants = await sql`SELECT COUNT(*) as count FROM "Tenant"`;
    const users = await sql`SELECT COUNT(*) as count FROM "User"`;
    const memberships = await sql`SELECT COUNT(*) as count FROM "Membership"`;
    console.log(`  ✓ Tenants: ${tenants[0].count}`);
    console.log(`  ✓ Users: ${users[0].count}`);
    console.log(`  ✓ Memberships: ${memberships[0].count}`);
    console.log('');
    console.log('🎯 Ready for testing!');
    console.log('   Run: node scripts/seed-simple.js');
    console.log('');
    
    await sql.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

cleanDatabase();

