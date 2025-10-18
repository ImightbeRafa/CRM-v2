import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const frequentProducts = await prisma.frequentProduct.findMany({
      where: { active: true },
      orderBy: [
        { isFavorite: 'desc' },
        { useCount: 'desc' },
        { lastUsed: 'desc' }
      ]
    });

    return NextResponse.json({
      status: 'success',
      data: frequentProducts
    });
  } catch (error) {
    console.error('Error fetching frequent products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch frequent products' },
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
    const { name, type, color, tamano, baseCost, isFavorite } = body;

    const frequentProduct = await prisma.frequentProduct.create({
      data: {
        name,
        type,
        color,
        tamano,
        baseCost,
        isFavorite: isFavorite || false,
        createdBy: token.sub as string
      }
    });

    return NextResponse.json({
      status: 'success',
      data: frequentProduct
    });
  } catch (error) {
    console.error('Error creating frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to create frequent product' },
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
    const { id, name, type, color, tamano, baseCost, isFavorite, active } = body;

    const frequentProduct = await prisma.frequentProduct.update({
      where: { id },
      data: {
        name,
        type,
        color,
        tamano,
        baseCost,
        isFavorite,
        active: active !== undefined ? active : true
      }
    });

    return NextResponse.json({
      status: 'success',
      data: frequentProduct
    });
  } catch (error) {
    console.error('Error updating frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to update frequent product' },
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
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    await prisma.frequentProduct.update({
      where: { id },
      data: { active: false }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Frequent product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to delete frequent product' },
      { status: 500 }
    );
  }
}
