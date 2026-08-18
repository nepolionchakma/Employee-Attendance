import { google } from 'googleapis'
import { isAllowedEmail } from './allowedEmails'

export { isAllowedEmail }

export function isOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function oauth2Client(origin) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/auth/callback`,
  )
}

export function buildAuthUrl(origin, state) {
  return oauth2Client(origin).generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  })
}

export async function exchangeCodeForUser(origin, code) {
  const client = oauth2Client(origin)
  const { tokens } = await client.getToken(code)
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  return {
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || null,
  }
}