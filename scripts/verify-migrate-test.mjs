/**
 * End-to-end test of migrateForeignColumns on SCRATCH tabs only.
 * 1. Creates zz-test-mig-* tab in admin + employee sheets.
 * 2. Plants a foreign Employee column (arupdas) with a real mark in the ADMIN scratch tab.
 * 3. Runs migrateForeignColumns(scratch, 'admin').
 * 4. Asserts the mark moved to the employee scratch tab and the foreign column is gone.
 * 5. Deletes both scratch tabs (cleanup, always).
 *
 * Run:  node --env-file=.env scripts/verify-migrate-test.mjs
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
if (!ADMIN_ID || !EMPLOYEE_ID) {
  console.log('SKIP: ADMIN and EMPLOYEE sheet ids required')
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
const auth = new google.auth.GoogleAuth({ credentials: loadCreds(), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })
const mod = await import('../lib/googleSheets.ts')

const colLetter = (i) => {
  let s = '', n = i + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
const getValues = async (sid, range) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: sid, range, valueRenderOption: 'FORMATTED_VALUE' })).data.values || []

let failed = 0
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed++
}

const scratch = `zz-test-mig-${Date.now() % 100000}`
const DAY = 5
console.log(`scratch tab: ${scratch}, test day: ${DAY}`)

async function deleteTab(sid, title) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sid, fields: 'sheets.properties.title,sheets.properties.sheetId' })
    const found = meta.data.sheets.find((s) => s.properties.title === title)
    if (!found) return
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sid, requestBody: { requests: [{ deleteSheet: { sheetId: found.properties.sheetId } }] } })
  } catch (e) { console.log(`  cleanup note (${title}): ${e.message}`) }
}

try {
  // 1. Scratch tabs (admin store -> only Admins + Test User; employee store -> only Employees + Test User)
  await mod.recreateAttendanceTab(scratch, [{ name: 'Test User', email: 'testuser.verify@gmail.com' }], 'admin')
  await mod.recreateAttendanceTab(scratch, [{ name: 'Test User', email: 'testuser.verify@gmail.com' }], 'employee')

  // 2. Plant foreign column: arupdas@gmail.com (Employee in Members) into ADMIN scratch, day-5 = On-site
  let rows = await getValues(ADMIN_ID, scratch)
  const headerRow = rows.findIndex((r) => String(r?.[0] || '').trim() === 'Date')
  const namesRow = String(rows[headerRow - 1]?.[2] || '').includes('@') ? headerRow - 1 : headerRow
  const startCol = Math.max(rows[namesRow].length, rows[headerRow].length, 2)
  await sheets.spreadsheets.values.update({
    spreadsheetId: ADMIN_ID, range: `${scratch}!${colLetter(startCol)}${namesRow + 1}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [['Arup Das <arupdas@gmail.com>']] },
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId: ADMIN_ID, range: `${scratch}!${colLetter(startCol)}${headerRow + 1}:${colLetter(startCol + 1)}${headerRow + 1}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [['Presence', 'Location']] },
  })
  const dayRowIdx = rows.findIndex((r, i) => i > headerRow && String(r?.[0] || '').trim() === String(DAY))
  await sheets.spreadsheets.values.update({
    spreadsheetId: ADMIN_ID, range: `${scratch}!${colLetter(startCol)}${dayRowIdx + 1}:${colLetter(startCol + 1)}${dayRowIdx + 1}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [['On-site - 9:01 AM', 'Test Road, Dhaka']] },
  })
  console.log('planted foreign Employee column in admin scratch tab')

  // 3. Run migrate
  const result = await mod.migrateForeignColumns(scratch, 'admin')
  console.log('migrate result:', JSON.stringify({ moved: result.moved, conflicts: result.conflicts, removed: result.removed, addedCount: result.addedCount }))

  // 4. Assertions
  const adminAfter = await getValues(ADMIN_ID, scratch)
  const ahead = adminAfter.findIndex((r) => String(r?.[0] || '').trim() === 'Date')
  const anames = adminAfter[String(adminAfter[ahead - 1]?.[2] || '').includes('@') ? ahead - 1 : ahead] || []
  ok(!anames.some((h) => String(h || '').includes('arupdas@gmail.com')), 'admin scratch: foreign column deleted')

  const empAfter = await getValues(EMPLOYEE_ID, scratch)
  const ehead = empAfter.findIndex((r) => String(r?.[0] || '').trim() === 'Date')
  const enames = empAfter[String(empAfter[ehead - 1]?.[2] || '').includes('@') ? ehead - 1 : ehead] || []
  const ecol = enames.findIndex((h) => String(h || '').includes('arupdas@gmail.com'))
  ok(ecol !== -1, 'employee scratch: arupdas column present')
  const eday = empAfter.findIndex((r, i) => i > ehead && String(r?.[0] || '').trim() === String(DAY))
  ok(String(empAfter[eday]?.[ecol] || '').trim() === 'On-site - 9:01 AM', `employee scratch: day-${DAY} presence moved (got "${empAfter[eday]?.[ecol]}")`)
  ok(String(empAfter[eday]?.[ecol + 1] || '').trim() === 'Test Road, Dhaka', `employee scratch: day-${DAY} location moved (got "${empAfter[eday]?.[ecol + 1]}")`)
  ok((result.moved || []).some((m) => m.email === 'arupdas@gmail.com' && m.days.includes(DAY)), 'migrate report lists the moved member+day')
} finally {
  // 5. Cleanup temp tabs (always)
  await deleteTab(ADMIN_ID, scratch)
  await deleteTab(EMPLOYEE_ID, scratch)
  console.log('scratch tabs deleted')
}

console.log(failed === 0 ? '\nMIGRATE TEST: ALL PASS ✅' : `\nMIGRATE TEST: ${failed} FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
