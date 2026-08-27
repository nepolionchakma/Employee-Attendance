import { NextResponse } from 'next/server'
import { exchangeCodeForUser, isAllowedEmail } from '@/lib/oauth'
import { ensureEmployeeTabForUser } from '@/lib/googleSheets'
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(request) {
  const origin = new URL(request.url).origin
  const fail = (error) => NextResponse.redirect(new URL(`/login?error=${error}`, origin))

  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value

  const response = NextResponse.redirect(new URL('/', origin))
  response.cookies.delete(OAUTH_STATE_COOKIE)

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('invalid_state')
  }

  try {
    const user = await exchangeCodeForUser(origin, code)
    if (!(await isAllowedEmail(user.email))) {
      return fail('not_allowed')
    }
    const token = await createSessionToken(user)
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    ensureEmployeeTabForUser(user.name, user.email).catch((e) =>
      console.error('Could not sync employee column after login:', e.message),
    )
    return response
  } catch (error) {
    console.error('Google OAuth callback failed:', error.message)
    return fail('oauth_failed')
  }
}