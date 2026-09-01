import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { isAdminEmail } from './oauth'

export const SESSION_COOKIE = 'session'
export const OAUTH_STATE_COOKIE = 'oauth_state'

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET is required in production. Set it in your environment variables.')
}
const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret-change-me'
const encodedKey = new TextEncoder().encode(SESSION_SECRET)
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export type SessionUser = {
  name: string
  email: string
  picture: string | null
  isAdmin: boolean
}

export type SessionPayload = JWTPayload & {
  name: string
  email: string
  picture: string | null
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export async function createSessionToken(user: { name: string; email: string; picture: string | null }): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(encodedKey)
}

export async function verifySessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ['HS256'] })
    const p = payload as SessionPayload
    const email = String(p.email || '')
    const isAdmin = await isAdminEmail(email)
    return {
      name: String(p.name || ''),
      email,
      picture: (p.picture as string | null) ?? null,
      isAdmin,
    }
  } catch {
    return null
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)
}
