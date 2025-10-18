import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Create sample frequent products
    const sampleProducts = [
      {
        name: 'Camiseta Básica',
        type: 'Camiseta',
        color: 'Blanco',
        tamano: 'M',
        baseCost: 15000,
        isFavorite: true,
        createdBy: token.sub as string
      },
      {
        name: 'Pantalón Jean',
        type: 'Pantalón',
        color: 'Azul',
        tamano: '32',
        baseCost: 25000,
        isFavorite: false,
        createdBy: token.sub as string
      },
      {
        name: 'Vestido Casual',
        type: 'Vestido',
        color: 'Negro',
        tamano: 'S',
        baseCost: 20000,
        isFavorite: true,
        createdBy: token.sub as string
      }
    ];

    // Create sample frequent customers
    const sampleCustomers = [
      {
        name: 'María González',
        phone: '8888-8888',
        province: 'San José',
        canton: 'San José',
        district: 'Carmen',
        email: 'maria@example.com',
        totalOrders: 5,
        createdBy: token.sub as string
      },
      {
        name: 'Carlos Rodríguez',
        phone: '7777-7777',
        province: 'Alajuela',
        canton: 'Alajuela',
        district: 'Centro',
        email: 'carlos@example.com',
        totalOrders: 3,
        createdBy: token.sub as string
      },
      {
        name: 'Ana Martínez',
        phone: '6666-6666',
        province: 'Cartago',
        canton: 'Cartago',
        district: 'Oriental',
        email: 'ana@example.com',
        totalOrders: 8,
        createdBy: token.sub as string
      }
    ];

    // Clear existing data
    await prisma.frequentProduct.deleteMany();
    await prisma.frequentCustomer.deleteMany();

    // Create new data
    await prisma.frequentProduct.createMany({
      data: sampleProducts
    });

    await prisma.frequentCustomer.createMany({
      data: sampleCustomers
    });

    return NextResponse.json({
      status: 'success',
      message: 'Sample frequent products and customers created successfully'
    });
  } catch (error) {
    console.error('Error seeding frequent data:', error);
    return NextResponse.json(
      { error: 'Failed to seed frequent data' },
      { status: 500 }
    );
  }
}
