import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request) {
  const response = NextResponse.redirect(new URL('/login', request.url))
  response.cookies.delete(SESSION_COOKIE)
  return response
}