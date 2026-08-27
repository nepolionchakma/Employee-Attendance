import { google } from 'googleapis'
import { ALLOWED_EMAILS, ADMIN_EMAILS } from './employees'

export function isOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function isAllowedEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  // Allow override via env (comma-separated); otherwise use employees.js
  const envAllowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  const allowed = envAllowed.length
    ? envAllowed
    : ALLOWED_EMAILS.map((e) => String(e).trim().toLowerCase()).filter(Boolean)

  if (allowed.length && !allowed.includes(normalized)) return false

  const domains = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const domain = normalized.split('@')[1]
  return domains.includes(domain)
}

export function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  const envAdmin = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  const admins = envAdmin.length
    ? envAdmin
    : ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  return admins.includes(normalized)
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