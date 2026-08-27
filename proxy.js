import { NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth'

export default async function proxy(request) {
  const session = await verifySessionToken(request.cookies.get('session')?.value)
  const { pathname } = request.nextUrl

  if (pathname === '/' && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname === '/login' && session) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (pathname.startsWith('/admin')) {
    if (!session) return NextResponse.redirect(new URL('/login', request.url))
    if (!session.isAdmin) return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/login', '/admin/:path*'],
}