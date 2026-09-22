/**
 * READ-ONLY holiday check. Imports the real lib functions (lib/googleSheets.ts)
 * and reports what the app sees in the ADMIN spreadsheet's holiday tab
 * (default name "Holiday List", override with HOLIDAYS_SHEET_TAB):
 * parsed dates, whether today is a holiday, and the day numbers the home-page
 * calendar would grey out for the current month.
 *
 * Writes NOTHING to the spreadsheet. Run:  node --env-file=.env scripts/verify-holidays.mjs
 */
import fs from 'node:fs'

const TZ = 'Asia/Dhaka'
const ADMIN_ID = (process.env.ADMIN_SPREADSHEET_ID || process.env.SPREADSHEET_ID || '').trim()
const HOLIDAYS_SHEET = (process.env.HOLIDAYS_SHEET_TAB || 'Holiday List').trim()

if (!ADMIN_ID) {
  console.log('MISSING admin spreadsheet id (ADMIN_SPREADSHEET_ID / SPREADSHEET_ID)')
  process.exit(2)
}

let failed = 0
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed++
}

// Same credential precedence as lib/googleSheets.ts: inline JSON, base64, then file.
function loadCreds() {
  const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
  if (inline.startsWith('{')) return JSON.parse(inline)
  const b64 = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim()
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return JSON.parse(fs.readFileSync('service-account.json', 'utf8'))
}

const { google } = await import('googleapis')
const auth = new google.auth.GoogleAuth({ credentials: loadCreds(), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth })

const meta = await sheets.spreadsheets.get({ spreadsheetId: ADMIN_ID, fields: 'sheets.properties.title' })
const tabs = meta.data.sheets.map((s) => s.properties.title)
console.log(`Admin tabs: ${tabs.map((t) => `"${t}"`).join(', ')}`)

const holidayTab = tabs.find((t) => t.trim().toLowerCase() === HOLIDAYS_SHEET.toLowerCase())
if (!holidayTab) {
  console.log(`\nHOLIDAY TAB "${HOLIDAYS_SHEET}" NOT FOUND — the app would apply no holidays.`)
  process.exit(1)
}

const view = await sheets.spreadsheets.values.get({
  spreadsheetId: ADMIN_ID,
  range: `${holidayTab}!A1:B60`,
  valueRenderOption: 'FORMATTED_VALUE',
})
console.log(`\nHoliday tab "${holidayTab}":`)
;(view.data.values || []).forEach((row, i) => console.log(`  ${i + 1}: ${JSON.stringify(row)}`))

// ---- the app's own view of the list (lib/googleSheets.ts) ----
const mod = await import('../lib/googleSheets.ts')

const holidays = await mod.getHolidays({ forceRefresh: true })
console.log(`\ngetHolidays() -> ${holidays.size} date(s):`)
for (const [key, name] of [...holidays].sort()) console.log(`  ${key}  ${name || '(no name)'}`)
ok(holidays.size > 0, 'holiday list parsed (not empty)')

const now = mod.nowParts()
const todayKey = mod.dateKey(now.year, now.month, now.day)
console.log(`\nToday (${TZ}): ${todayKey}`)

const today = await mod.getTodayHoliday()
if (holidays.has(todayKey)) {
  ok(today !== null, `getTodayHoliday() detected today's holiday (${today?.name})`)
} else {
  ok(today === null, 'getTodayHoliday() -> null on a working day')
  console.log('(today is NOT a holiday — submissions stay enabled)')
}

const inMonth = await mod.getHolidaysInMonth(now.year, now.month)
console.log(`\ngetHolidaysInMonth(${now.year}, ${now.month}) -> ${JSON.stringify(inMonth)}`)
const expectedDays = [...holidays.keys()]
  .filter((k) => k.startsWith(`${now.year}-${String(now.month).padStart(2, '0')}-`))
  .map((k) => String(Number(k.slice(8, 10))))
ok(
  Object.keys(inMonth).sort().join(',') === expectedDays.sort().join(','),
  `calendar day numbers match the list (${expectedDays.join(', ') || 'none'})`,
)

ok(mod.isHolidaysTab(holidayTab), `isHolidaysTab("${holidayTab}") -> holiday tab is hidden from the tab pickers`)

console.log(failed === 0 ? '\nHOLIDAY CHECK: PASS ✅' : `\nHOLIDAY CHECK: ${failed} FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
