// middleware.ts
import { NextResponse } from "next/server"

// Simple middleware that always allows access
export default function middleware() {
  return NextResponse.next()
}

// Empty matcher means middleware won't run
export const config = {
  matcher: []
}