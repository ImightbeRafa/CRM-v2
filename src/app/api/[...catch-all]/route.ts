import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { 
      error: 'API endpoint not found',
      message: 'The requested API endpoint does not exist',
      availableEndpoints: [
        '/api/auth/[...nextauth]',
        '/api/users',
        '/api/orders',
        '/api/clients',
        '/api/config/*',
        '/api/billing/*',
        '/api/estadisticas/*',
        '/api/tilopay/*',
        '/api/chat/*',
        '/api/social/*'
      ]
    },
    { status: 404 }
  );
}

export async function POST() {
  return NextResponse.json(
    { 
      error: 'API endpoint not found',
      message: 'The requested API endpoint does not exist'
    },
    { status: 404 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { 
      error: 'API endpoint not found',
      message: 'The requested API endpoint does not exist'
    },
    { status: 404 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { 
      error: 'API endpoint not found',
      message: 'The requested API endpoint does not exist'
    },
    { status: 404 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    { 
      error: 'API endpoint not found',
      message: 'The requested API endpoint does not exist'
    },
    { status: 404 }
  );
}
