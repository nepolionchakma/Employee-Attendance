/**
 * READ-ONLY isolation check: verifies each spreadsheet holds ONLY its own
 * group's members (Admin -> admin sheet, Employee -> employee sheet,
 * Bootcamp -> bootcamp sheet), based on the Members directory roles.
 *
 * Writes NOTHING. Run:  node --env-file=.env scripts/verify-store-isolation.mjs
 */
const envAny = (...names) => {
  for (const n of names) {
    const v = String(process.env[n] || '').trim()
    if (v) return v
  }
  return ''
}

const ADMIN_ID = envAny('ADMIN_SPREADSHEET_ID', 'admin_sheet_id', 'SPREADSHEET_ID')
const EMPLOYEE_ID = envAny('EMPLOYEE_SPREADSHEET_ID', 'employee_sheet_id')
const BOOTCAMP_ID = envAny('BOOTCAMP_SPREADSHEET_ID', 'bootcamp_sheet_id')
const PINNED_TAB = (process.env.ATTENDANCE_SHEET_TAB || '').trim()

if (!ADMIN_ID) {
  console.log('MISSING admin spreadsheet id (ADMIN_SPREADSHEET_ID / SPREADSHEET_ID)')
  process.exit(2)
}

const { google } = await import('googleapis')
const fs = await import('node:fs')

function loadCreds() {
  const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
  if (inline.startsWith('{')) return JSON.parse(inline)
  const b64 = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim()
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return JSON.parse(fs.readFileSync('service-account.json', 'utf8'))
}

const auth = new google.auth.GoogleAuth({ credentials: loadCreds(), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth })

const monthTab = PINNED_TAB || new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Dhaka', year: 'numeric', month: 'long',
}).format(new Date())

const normRole = (v) => {
  const r = String(v || '').trim().toLowerCase()
  if (r === 'admin') return 'Admin'
  if (r === 'bootcamp') return 'Bootcamp'
  return 'Employee'
}
const parseEmail = (h) => {
  const m = String(h || '').match(/<([^>]+@[^>]+)>/)
  return m ? m[1].trim().toLowerCase() : null
}

async function getValues(spreadsheetId, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' })
  return res.data.values || []
}

// 1. Members directory from the ADMIN sheet
const memberRows = await getValues(ADMIN_ID, 'Members!A1:E')
const roleByEmail = new Map()
for (let i = 1; i < memberRows.length; i++) {
  const email = String(memberRows[i]?.[1] || '').trim().toLowerCase()
  if (email.includes('@')) roleByEmail.set(email, normRole(memberRows[i]?.[3]))
}
console.log(`Members in admin sheet: ${roleByEmail.size}`)
for (const r of ['Admin', 'Employee', 'Bootcamp']) {
  console.log(`  ${r}: ${[...roleByEmail.values()].filter((x) => x === r).length}`)
}

const stores = [
  { store: 'admin', id: ADMIN_ID, expected: 'Admin' },
  { store: 'employee', id: EMPLOYEE_ID || ADMIN_ID, expected: 'Employee', fallback: !EMPLOYEE_ID },
  { store: 'bootcamp', id: BOOTCAMP_ID || ADMIN_ID, expected: 'Bootcamp', fallback: !BOOTCAMP_ID },
]

let foreignTotal = 0
for (const s of stores) {
  console.log(`\n--- ${s.store} sheet (${s.fallback ? 'FALLBACK to admin sheet' : 'configured'}) ---`)
  let tabs = []
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: s.id, fields: 'sheets.properties.title' })
    tabs = meta.data.sheets.map((x) => x.properties.title)
  } catch (e) {
    console.log(`  ERROR listing tabs: ${e.message}`)
    foreignTotal++
    continue
  }
  if (!tabs.includes(monthTab)) {
    console.log(`  month tab "${monthTab}" not present yet (no columns created — OK until first use)`)
    continue
  }
  const rows = await getValues(s.id, monthTab)
  const headerRow = rows.findIndex((r) => String(r?.[0] || '').trim() === 'Date')
  if (headerRow === -1) {
    console.log(`  tab "${monthTab}" has no attendance header (raw sheet) — skipped`)
    continue
  }
  const above = rows[headerRow - 1] || []
  const namesRow = above.some((c) => String(c || '').includes('@')) ? headerRow - 1 : headerRow
  const emails = []
  for (let c = 2; c < (rows[namesRow] || []).length; c += 2) {
    const em = parseEmail(rows[namesRow][c])
    if (em) emails.push(em)
  }
  const ok = []
  const foreign = []
  const unknown = []
  for (const em of emails) {
    const role = roleByEmail.get(em)
    if (!role) unknown.push(em)
    else if (role !== s.expected) foreign.push(`${em} (${role})`)
    else ok.push(em)
  }
  const missing = [...roleByEmail.entries()].filter(([em, r]) => r === s.expected && !emails.includes(em)).map(([em]) => em)
  console.log(`  tab "${monthTab}": ${emails.length} column(s) -> ${ok.length} correct, ${foreign.length} FOREIGN, ${unknown.length} unknown`)
  for (const f of foreign) console.log(`    FOREIGN: ${f}`)
  for (const u of unknown) console.log(`    unknown (not in Members): ${u}`)
  if (missing.length) console.log(`    missing ${s.expected} (no column yet): ${missing.join(', ')}`)
  foreignTotal += foreign.length
}

console.log(foreignTotal === 0 ? '\nISOLATION CHECK: PASS ✅ (no foreign members)' : `\nISOLATION CHECK: FAIL ❌ (${foreignTotal} foreign column(s))`)
process.exit(foreignTotal === 0 ? 0 : 1)
