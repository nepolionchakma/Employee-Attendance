import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { isAdminEmail } from './oauth'

export const SESSION_COOKIE = 'session'
export const OAUTH_STATE_COOKIE = 'oauth_state'

const SESSION_SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret-change-me'
const encodedKey = new TextEncoder().encode(SESSION_SECRET)
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  }
}

export async function createSessionToken(user) {
  return new SignJWT({ name: user.name, email: user.email, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(encodedKey)
}

export async function verifySessionToken(token) {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ['HS256'] })
    const email = payload.email
    return {
      name: payload.name,
      email,
      picture: payload.picture,
      isAdmin: isAdminEmail(email),
    }
  } catch {
    return null
  }
}

export async function getSessionUser() {
  const cookieStore = await cookies()
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)
}