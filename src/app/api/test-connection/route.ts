import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    console.log('Testing basic connection...')
    
    return NextResponse.json({
      status: 'success',
      message: 'Basic connection test successful',
      timestamp: new Date().toISOString(),
      data: {
        server: 'running',
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('Connection test error:', error)
    return NextResponse.json({
      status: 'error',
      error: 'Connection test failed: ' + String(error)
    }, { status: 500 })
  }
}
