import { NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth'

export default async function proxy(request) {
  const session = await verifySessionToken(request.cookies.get('session')?.value)

  if (request.nextUrl.pathname === '/' && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (request.nextUrl.pathname === '/login' && session) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/login'],
}