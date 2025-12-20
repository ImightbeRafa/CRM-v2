import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    // Get master user credentials from environment variables
    const masterUsername = process.env.MASTER_USERNAME || 'admin';
    const masterPassword = process.env.MASTER_PASSWORD || 'admin123';
    
    // Check if master user already exists
    const existingMaster = await prisma.user.findFirst({
      where: { 
        role: 'MASTER',
        active: true
      }
    });
    
    if (existingMaster) {
      return NextResponse.json({
        status: 'success',
        message: 'Master user already exists',
        data: {
          username: existingMaster.username,
          role: existingMaster.role
        }
      });
    }
    
    // Hash the master password
    const hashedPassword = await bcrypt.hash(masterPassword, 12);
    
    // Create master user
    const masterUser = await prisma.user.create({
      data: {
        username: masterUsername,
        password: hashedPassword,
        role: 'MASTER',
        active: true
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true
      }
    });
    
    return NextResponse.json({
      status: 'success',
      message: 'Master user created successfully',
      data: {
        username: masterUser.username,
        role: masterUser.role,
        createdAt: masterUser.createdAt
      }
    });
    
  } catch (error) {
    console.error('Error creating master user:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: 'Failed to create master user',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check if master user exists
export async function GET(request: NextRequest) {
  try {
    const masterUser = await prisma.user.findFirst({
      where: { 
        role: 'MASTER',
        active: true
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true
      }
    });
    
    if (masterUser) {
      return NextResponse.json({
        status: 'success',
        exists: true,
        data: {
          username: masterUser.username,
          role: masterUser.role,
          createdAt: masterUser.createdAt
        }
      });
    } else {
      return NextResponse.json({
        status: 'success',
        exists: false,
        message: 'No master user found'
      });
    }
    
  } catch (error) {
    console.error('Error checking master user:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: 'Failed to check master user',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
