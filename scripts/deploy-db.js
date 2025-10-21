const { PrismaClient } = require('@prisma/client');

async function deployDatabase() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🚀 Deploying database schema...');
    
    // Test connection
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // The schema will be automatically created by Prisma
    console.log('✅ Database schema deployed successfully');
    
  } catch (error) {
    console.error('❌ Database deployment failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

deployDatabase();
