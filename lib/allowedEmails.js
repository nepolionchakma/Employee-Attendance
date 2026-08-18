export function isAllowedEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)

  if (allowed.length && !allowed.includes(normalized)) return false

  const domains = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const domain = normalized.split('@')[1]
  return domains.includes(domain)
}