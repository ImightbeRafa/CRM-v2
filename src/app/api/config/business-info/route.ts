import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const businessInfo = await prisma.businessInfo.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error fetching business info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch business info' },
      { status: 500 }
    );
  }
}

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

    const body = await request.json();
    const { name, type, label, placeholder, options, required, order } = body;

    const businessInfo = await prisma.businessInfo.create({
      data: {
        name,
        type,
        label,
        placeholder,
        options: options ? JSON.stringify(options) : null,
        required: required || false,
        order: order || 0,
        isActive: true,
        createdBy: token.sub as string
      }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error creating business info:', error);
    return NextResponse.json(
      { error: 'Failed to create business info' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, type, label, placeholder, options, required, order, active } = body;

    const businessInfo = await prisma.businessInfo.update({
      where: { id },
      data: {
        name,
        type,
        label,
        placeholder,
        options: options ? JSON.stringify(options) : null,
        required: required || false,
        order: order || 0,
        isActive: active !== undefined ? active : true,
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error updating business info:', error);
    return NextResponse.json(
      { error: 'Failed to update business info' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Business info ID is required' }, { status: 400 });
    }

    await prisma.businessInfo.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Business info deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting business info:', error);
    return NextResponse.json(
      { error: 'Failed to delete business info' },
      { status: 500 }
    );
  }
}
