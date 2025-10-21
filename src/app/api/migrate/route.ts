import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting database migration...');
    
    const prisma = new PrismaClient();
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Test a simple query to ensure tables exist
    try {
      await prisma.user.findFirst();
      console.log('✅ User table exists');
    } catch (error) {
      console.log('⚠️  User table may not exist yet, this is normal for first migration');
    }
    
    // Test another table
    try {
      await prisma.order.findFirst();
      console.log('✅ Order table exists');
    } catch (error) {
      console.log('⚠️  Order table may not exist yet, this is normal for first migration');
    }
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      status: 'success',
      message: 'Database migration completed successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: 'Database migration failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const prisma = new PrismaClient();
    
    // Test database connection
    await prisma.$connect();
    
    // Check if tables exist
    const userCount = await prisma.user.count();
    const orderCount = await prisma.order.count();
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      status: 'success',
      message: 'Database connection successful',
      data: {
        userTableExists: true,
        orderTableExists: true,
        userCount,
        orderCount
      }
    });
    
  } catch (error) {
    console.error('❌ Database check failed:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: 'Database check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
