import { google } from 'googleapis'
import { ALLOWED_EMAILS as FALLBACK_ALLOWED, ADMIN_EMAILS as FALLBACK_ADMIN } from './employees'

export function isOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

async function getAllowedList(): Promise<string[]> {
  const envAllowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (envAllowed.length) return envAllowed
  try {
    const { getEmployees, hasGoogleCredentials } = await import('./googleSheets')
    if (hasGoogleCredentials()) {
      const list = await getEmployees()
      const fromSheet = list.map((m: { email: string }) => String(m.email || '').trim().toLowerCase()).filter(Boolean)
      if (fromSheet.length) return fromSheet
    }
  } catch {}
  return FALLBACK_ALLOWED.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
}

async function getAdminList(): Promise<string[]> {
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
        .filter((m: { role: string }) => String(m.role || '').toLowerCase() === 'admin')
        .map((m: { email: string }) => String(m.email || '').trim().toLowerCase())
        .filter(Boolean)
      if (fromSheet.length) return fromSheet
    }
  } catch {}
  return FALLBACK_ADMIN.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
}

export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || '').trim().toLowerCase()
  const allowed = await getAllowedList()
  // If Google credentials exist but the allowed list is empty or the email is not in it, deny access
  if (!allowed.includes(normalized)) return false
  const domains = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const domain = normalized.split('@')[1]
  return domains.includes(domain ?? '')
}

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || '').trim().toLowerCase()
  const admins = await getAdminList()
  return admins.includes(normalized)
}

// Sync fallback for non-critical paths
export function isAdminEmailSync(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase()
  const envAdmin = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (envAdmin.length) return envAdmin.includes(normalized)
  return FALLBACK_ADMIN.map((e) => String(e).trim().toLowerCase()).includes(normalized)
}

function oauth2Client(origin: string): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/auth/callback`,
  )
}

export function buildAuthUrl(origin: string, state: string): string {
  return oauth2Client(origin).generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  })
}

export async function exchangeCodeForUser(
  origin: string,
  code: string,
): Promise<{ email: string; name: string; picture: string | null }> {
  const client = oauth2Client(origin)
  const { tokens } = await client.getToken(code)
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()!
  return {
    email: String(payload.email || ''),
    name: String(payload.name || payload.email || ''),
    picture: (payload.picture as string | null) ?? null,
  }
}
