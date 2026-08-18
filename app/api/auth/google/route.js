import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { buildAuthUrl, isOAuthConfigured } from '@/lib/oauth'
import { OAUTH_STATE_COOKIE, sessionCookieOptions } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(request) {
  if (!isOAuthConfigured()) {
    return NextResponse.redirect(new URL('/login?error=setup', request.url))
  }

  const state = randomUUID()
  const url = buildAuthUrl(new URL(request.url).origin, state)
  const response = NextResponse.redirect(url)
  response.cookies.set(OAUTH_STATE_COOKIE, state, sessionCookieOptions(60 * 10))
  return response
}