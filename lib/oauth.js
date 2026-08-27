import { google } from 'googleapis'
import { ALLOWED_EMAILS as FALLBACK_ALLOWED, ADMIN_EMAILS as FALLBACK_ADMIN } from './employees'

export function isOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

async function getAllowedList() {
  const envAllowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (envAllowed.length) return envAllowed
  try {
    const { getEmployees, hasGoogleCredentials } = await import('./googleSheets')
    if (hasGoogleCredentials()) {
      const list = await getEmployees()
      const fromSheet = list.map((m) => String(m.email || '').trim().toLowerCase()).filter(Boolean)
      if (fromSheet.length) return fromSheet
    }
  } catch {}
  return FALLBACK_ALLOWED.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
}

async function getAdminList() {
  const envAdmin = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (envAdmin.length) return envAdmin
  try {
    const { getEmployees, hasGoogleCredentials } = await import('./googleSheets')
    if (hasGoogleCredentials()) {
      const list = await getEmployees()
      const fromSheet = list
        .filter((m) => String(m.role || '').toLowerCase() === 'admin')
        .map((m) => String(m.email || '').trim().toLowerCase())
        .filter(Boolean)
      if (fromSheet.length) return fromSheet
    }
  } catch {}
  return FALLBACK_ADMIN.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
}

export async function isAllowedEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  const allowed = await getAllowedList()
  if (allowed.length && !allowed.includes(normalized)) return false
  const domains = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const domain = normalized.split('@')[1]
  return domains.includes(domain)
}

export async function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  const admins = await getAdminList()
  return admins.includes(normalized)
}

// Sync fallbacks for non-critical paths (e.g. initial render)
export function isAdminEmailSync(email) {
  const normalized = String(email || '').trim().toLowerCase()
  const envAdmin = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (envAdmin.length) return envAdmin.includes(normalized)
  return FALLBACK_ADMIN.map((e) => String(e).trim().toLowerCase()).includes(normalized)
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