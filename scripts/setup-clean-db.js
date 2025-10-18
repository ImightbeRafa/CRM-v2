const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function setupCleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');
    
    // Clear all tables
    await prisma.auditLog.deleteMany();
    await prisma.frequentCustomer.deleteMany();
    await prisma.frequentProduct.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    
    console.log('✅ Database cleaned');
    
    // Create default master user
    const hashedPassword = await bcrypt.hash('admin123', 12);
    const masterUser = await prisma.user.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        role: 'MASTER',
        active: true
      }
    });
    
    console.log('✅ Master user created:', masterUser.username);
    
    // Create some sample frequent products
    const sampleProducts = [
      {
        name: 'Camiseta Básica',
        type: 'Ropa',
        color: 'Blanco',
        tamano: 'M',
        baseCost: 15000,
        isFavorite: true,
        createdBy: masterUser.id
      },
      {
        name: 'Pantalón Jeans',
        type: 'Ropa',
        color: 'Azul',
        tamano: 'L',
        baseCost: 25000,
        isFavorite: true,
        createdBy: masterUser.id
      }
    ];
    
    for (const product of sampleProducts) {
      await prisma.frequentProduct.create({ data: product });
    }
    
    console.log('✅ Sample products created');
    
    // Create some sample frequent customers
    const sampleCustomers = [
      {
        name: 'Juan Pérez',
        phone: '8888-8888',
        province: 'San José',
        canton: 'San José',
        district: 'Carmen',
        email: 'juan@example.com',
        createdBy: masterUser.id
      },
      {
        name: 'María González',
        phone: '7777-7777',
        province: 'Cartago',
        canton: 'Cartago',
        district: 'Oriental',
        email: 'maria@example.com',
        createdBy: masterUser.id
      }
    ];
    
    for (const customer of sampleCustomers) {
      await prisma.frequentCustomer.create({ data: customer });
    }
    
    console.log('✅ Sample customers created');
    
    console.log('🎉 Database setup complete!');
    console.log('📝 Login credentials:');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    
  } catch (error) {
    console.error('❌ Error setting up database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupCleanDatabase();
