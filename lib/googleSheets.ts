
import fs from 'node:fs'

function envAny(...names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] || '').trim()
    if (v) return v
  }
  return ''
}

/* ---- Multi-spreadsheet routing ----
 * Members directory always lives in the ADMIN spreadsheet.
 * Attendance writes are routed by member role:
 *   Admin    -> ADMIN spreadsheet
 *   Employee -> EMPLOYEE spreadsheet (falls back to ADMIN when unset)
 *   Bootcamp -> BOOTCAMP spreadsheet (falls back to ADMIN when unset)
 * Legacy SPREADSHEET_ID is kept as the ADMIN fallback so old setups keep working.
 */
export const ADMIN_SPREADSHEET_ID: string =
  envAny('ADMIN_SPREADSHEET_ID', 'admin_sheet_id', 'SPREADSHEET_ID')
export const BOOTCAMP_SPREADSHEET_ID: string =
  envAny('BOOTCAMP_SPREADSHEET_ID', 'bootcamp_sheet_id')
export const EMPLOYEE_SPREADSHEET_ID: string =
  envAny('EMPLOYEE_SPREADSHEET_ID', 'employee_sheet_id')
/** Legacy single-sheet export — same as the admin spreadsheet. */
export const SPREADSHEET_ID: string = ADMIN_SPREADSHEET_ID
export const SHEET_TAB = process.env.ATTENDANCE_SHEET_TAB || ''

export type StoreKind = 'admin' | 'employee' | 'bootcamp'

export function normalizeStore(v: unknown): StoreKind {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'bootcamp') return 'bootcamp'
  if (s === 'employee') return 'employee'
  return 'admin'
}

/** Resolved spreadsheet ID for a store (falls back to the admin sheet). */
export function spreadsheetIdForStore(store?: unknown): string {
  const s = normalizeStore(store)
  if (s === 'bootcamp' && BOOTCAMP_SPREADSHEET_ID) return BOOTCAMP_SPREADSHEET_ID
  if (s === 'employee' && EMPLOYEE_SPREADSHEET_ID) return EMPLOYEE_SPREADSHEET_ID
  return ADMIN_SPREADSHEET_ID
}

/** Which stores have an explicit spreadsheet ID configured. */
export function listConfiguredStores(): { store: StoreKind; spreadsheetId: string; configured: boolean; label: string }[] {
  return [
    { store: 'admin', spreadsheetId: spreadsheetIdForStore('admin'), configured: Boolean(ADMIN_SPREADSHEET_ID), label: 'Admin' },
    { store: 'employee', spreadsheetId: spreadsheetIdForStore('employee'), configured: Boolean(EMPLOYEE_SPREADSHEET_ID), label: 'Employee' },
    { store: 'bootcamp', spreadsheetId: spreadsheetIdForStore('bootcamp'), configured: Boolean(BOOTCAMP_SPREADSHEET_ID), label: 'Bootcamp' },
  ]
}

/** Env toggle so admins can be blocked from submitting attendance (testing). */
export function adminCanSubmitAttendance(): boolean {
  const v = (process.env.ADMIN_CAN_SUBMIT_ATTENDANCE || 'yes').trim().toLowerCase()
  return !['no', 'false', '0', 'off', 'disable', 'disabled', 'n'].includes(v)
}

const CREDENTIALS_ENV = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
const CREDENTIALS_JSON = CREDENTIALS_ENV.startsWith('{') ? CREDENTIALS_ENV : ''
const CREDENTIALS_PATH =
  CREDENTIALS_JSON ? '' : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json')

const CREDENTIALS_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''

const TZ = 'Asia/Dhaka'

const ABSENT_SECTION = 'Absent Days'
const COLS_PER_EMPLOYEE = 2

/**
 * Time merged into the auto-absent presence cell for past days ('Absent - 12:00 AM').
 * Customize with AUTO_ABSENT_TIME in .env (e.g. AUTO_ABSENT_TIME="2:00 AM" for testing).
 */
export const AUTO_ABSENT_TIME = (process.env.AUTO_ABSENT_TIME || '12:00 AM').trim() || '12:00 AM'

/** Default Location for absent days — no place is recorded when nobody was in. */
const ABSENT_LOCATION = 'N/A'

export function hasGoogleCredentials() {
  return Boolean(CREDENTIALS_JSON || CREDENTIALS_BASE64) || fs.existsSync(CREDENTIALS_PATH)
}

async function loadCredentials() {
  if (CREDENTIALS_JSON) {
    return JSON.parse(CREDENTIALS_JSON)
  }
  if (CREDENTIALS_BASE64) {
    return JSON.parse(Buffer.from(CREDENTIALS_BASE64, 'base64').toString('utf8'))
  }
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Service account file not found at ${CREDENTIALS_PATH}. ` +
      'Create one in the Google Cloud console, download the JSON, and place it in the project root, ' +
      'or set GOOGLE_SERVICE_ACCOUNT_JSON on the host (Vercel) to the stringified JSON. ' +
      'Then share your spreadsheet with the service account email (Editor).',
    )
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'))
}

async function sheetsClient(spreadsheetId?: string) {
  const { google } = await import('googleapis')
  const sid = (spreadsheetId || '').trim() || ADMIN_SPREADSHEET_ID
  if (!sid) {
    throw new Error('No spreadsheet ID is set. Add ADMIN_SPREADSHEET_ID (or SPREADSHEET_ID) to .env (see .env.example).')
  }
  const credentials = await loadCredentials()
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client } as any)
}

async function listTabs(sheets: any, spreadsheetId?: string) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: (spreadsheetId || '').trim() || ADMIN_SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  })
  return res.data.sheets.map((s: any) => s.properties.title)
}

async function sheetIdFor(sheets: any, tab: string, spreadsheetId?: string) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: (spreadsheetId || '').trim() || ADMIN_SPREADSHEET_ID,
    fields: 'sheets.properties.title,sheets.properties.sheetId',
  })
  return res.data.sheets.find((s: any) => s.properties.title === tab)?.properties.sheetId
}

/* ---- Employees / Members directory ---- */
const EMPLOYEES_SHEET = (process.env.EMPLOYEES_SHEET_TAB || 'Members').trim() || 'Members'
const EMPLOYEES_SHEET_CANDIDATES = [EMPLOYEES_SHEET].filter(Boolean)

let employeesCache: any[] | null = null
let employeesCacheAt = 0
const EMPLOYEES_CACHE_TTL = 60 * 1000

export type MemberRole = 'Admin' | 'Employee' | 'Bootcamp'

export function normalizeRole(v: string): MemberRole {
  const r = String(v || '').trim().toLowerCase()
  if (r === 'admin') return 'Admin'
  if (r === 'bootcamp') return 'Bootcamp'
  return 'Employee'
}

/** Role for an email from the Members directory (admin sheet). Returns null when unknown. */
export async function getRoleForEmail(email: string): Promise<MemberRole | null> {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  try {
    const list = await getEmployees()
    const found = list.find((m: { email: string }) => String(m.email || '').trim().toLowerCase() === target)
    if (found) return normalizeRole((found as { role?: string }).role || '')
  } catch {}
  return null
}

/** Attendance store for an email, resolved via its Members role. */
export async function storeForEmail(email: string): Promise<StoreKind> {
  const role = await getRoleForEmail(email)
  if (role === 'Bootcamp') return 'bootcamp'
  if (role === 'Admin') return 'admin'
  return 'employee'
}

/** Expected member role for a store — strict isolation between sheets. */
export function roleForStore(store: StoreKind): MemberRole {
  if (store === 'bootcamp') return 'Bootcamp'
  if (store === 'employee') return 'Employee'
  return 'Admin'
}

/**
 * Rejects writes for emails whose *known* Members role belongs to another store.
 * Unknown emails (not in Members) are allowed — tests and legacy columns need them.
 */
async function assertStoreMember(email: string | null | undefined, store: StoreKind) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return
  const role = await getRoleForEmail(e)
  if (!role) return
  if (role !== roleForStore(store)) {
    throw new Error(
      `"${e}" is ${role} and belongs to the ${role.toLowerCase()} sheet — not the ${store} sheet.`,
    )
  }
}

async function resolveEmployeesSheetName(sheets: any) {
  return EMPLOYEES_SHEET
}

export async function ensureEmployeesSheet() {
  const sid = ADMIN_SPREADSHEET_ID
  if (!hasGoogleCredentials() || !sid) return EMPLOYEES_SHEET
  const sheets = await sheetsClient()
  const tabs = await listTabs(sheets)
  const desired = EMPLOYEES_SHEET
  if (tabs.includes(desired)) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range: `${desired}!A1:D`,
        valueRenderOption: 'FORMATTED_VALUE',
      })
      const rows = res.data.values || []
      if (rows.length < 2) {
        const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
        const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
        const seed = (ALLOWED_EMAILS || []).map((email) => {
          const e = String(email).trim()
          const name = e.split('@')[0].replace(/[._]/g, ' ')
          const role = adminSet.has(e.toLowerCase()) ? 'Admin' : 'Employee'
          return [name, e, '', role]
        })
        if (seed.length) {
          if (rows.length === 0 || String(rows[0][0] || '').trim() !== 'Full Name') {
            await sheets.spreadsheets.values.update({
              spreadsheetId: sid,
              range: `${desired}!A1`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [['Full Name', 'Gmail', 'Phone', 'Role']] },
            })
          }
          await sheets.spreadsheets.values.update({
            spreadsheetId: sid,
            range: `${desired}!A2`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: seed },
          })
          employeesCache = null
        }
      }
    } catch (_e) { }
    return desired
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: { requests: [{ addSheet: { properties: { title: desired } } }] },
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${desired}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Full Name', 'Gmail', 'Phone', 'Role']] },
  })
  try {
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    const rows = (ALLOWED_EMAILS || []).map((email) => {
      const e = String(email).trim()
      const name = e.split('@')[0].replace(/[._]/g, ' ')
      const role = adminSet.has(e.toLowerCase()) ? 'Admin' : 'Employee'
      return [name, e, '', role]
    })
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${desired}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      })
    }
  } catch (_e) { }
  employeesCache = null
  return desired
}

export async function getEmployees({ forceRefresh = false } = {}) {
  const sid = ADMIN_SPREADSHEET_ID
  if (!hasGoogleCredentials() || !sid) {
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    return (ALLOWED_EMAILS || []).map((email) => ({
      name: String(email).split('@')[0].replace(/[._]/g, ' '),
      email: String(email).trim(),
      phone: '',
      role: adminSet.has(String(email).trim().toLowerCase()) ? 'Admin' : 'Employee',
    }))
  }
  const now = Date.now()
  if (!forceRefresh && employeesCache && now - employeesCacheAt < EMPLOYEES_CACHE_TTL) {
    return employeesCache
  }
  try {
    await ensureEmployeesSheet()
    const sheets = await sheetsClient()
    const tab = await resolveEmployeesSheetName(sheets)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `${tab}!A1:E`,
      valueRenderOption: 'FORMATTED_VALUE',
    })
    const rows = res.data.values || []
    if (rows.length < 2) {
      const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
      const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
      const fallback = (ALLOWED_EMAILS || []).map((email) => ({
        name: String(email).split('@')[0].replace(/[._]/g, ' '),
        email: String(email).trim(),
        phone: '',
        role: adminSet.has(String(email).trim().toLowerCase()) ? 'Admin' : 'Employee',
      }))
      employeesCache = fallback
      employeesCacheAt = now
      return fallback
    }
    const list = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || []
      const name = String(r[0] || '').trim()
      const email = String(r[1] || '').trim()
      const phone = String(r[2] || '').trim()
      const role = normalizeRole(r[3])
      const address = String(r[4] || '').trim()
      if (!email || !email.includes('@')) continue
      list.push({ name: name || email.split('@')[0], email, phone, role, address })
    }
    employeesCache = list
    employeesCacheAt = now
    return list
  } catch (e) {
    console.warn('getEmployees failed, fallback to employees:', (e as Error).message)
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    return (ALLOWED_EMAILS || []).map((email) => ({
      name: String(email).split('@')[0].replace(/[._]/g, ' '),
      email: String(email).trim(),
      phone: '',
      role: adminSet.has(String(email).trim().toLowerCase()) ? 'Admin' : 'Employee',
    }))
  }
}

export function clearEmployeesCache() {
  employeesCache = null
  employeesCacheAt = 0
}

/**
 * 0-based indexes of member data rows: every row after the header that has
 * any content. Blank gap rows (left by past bad appends or manual deletes)
 * are skipped so a member's list index always maps to the right physical row.
 */
function memberDataRowIndexes(rows: any[]) {
  const idxs: number[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || []
    if (r.some((cell: any) => String(cell ?? '').trim() !== '')) idxs.push(i)
  }
  return idxs
}

async function readEmployeesGrid(sheets: any, tab: string) {
  const sid = ADMIN_SPREADSHEET_ID
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: `${tab}!A1:E`,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  return res.data.values || []
}

export async function addEmployee({ name, email, phone = '', role = 'Employee', address = '' }: { name?: string; email: string; phone?: string; role?: string; address?: string }) {
  const sid = ADMIN_SPREADSHEET_ID
  if (!email || !email.includes('@')) throw new Error('Valid Gmail is required')
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  // Write explicitly at the first empty row after the last data row, starting
  // at column A. values.append is intentionally NOT used here: its automatic
  // table detection misfires on tabs with blank gap rows and silently shifted
  // new members to column D instead of A.
  const rows = await readEmployeesGrid(sheets, tab)
  let writeRow = Math.max(rows.length, 2) // 1-based; falls back to row 2 on a header-only tab
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i] || []
    if (r.some((cell: any) => String(cell ?? '').trim() !== '')) {
      writeRow = i + 2 // first row after the last non-empty one
      break
    }
  }
  const values = [[String(name || '').trim() || email.split('@')[0], String(email).trim(), String(phone).trim(), normalizeRole(role), String(address).trim()]]
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!A${writeRow}:E${writeRow}`,
    // RAW, not USER_ENTERED: USER_ENTERED parses phone numbers like '01712345678'
    // as numbers and strips the leading zero.
    valueInputOption: 'RAW',
    requestBody: { values },
  })
  clearEmployeesCache()
  return true
}

export async function updateEmployee(rowIndex: number, { name, email, phone, role, address }: { name: string; email: string; phone: string; role: string; address?: string }) {
  const sid = ADMIN_SPREADSHEET_ID
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  // The UI index counts only non-empty data rows — resolve the physical sheet
  // row instead of assuming rowIndex+2, which breaks when blank gap rows exist.
  const rows = await readEmployeesGrid(sheets, tab)
  const dataRows = memberDataRowIndexes(rows)
  const target = dataRows[rowIndex]
  if (target === undefined) throw new Error(`Member row ${rowIndex} not found in the ${tab} sheet`)
  const sheetRow = target + 1
  const values = [[String(name || '').trim(), String(email || '').trim(), String(phone || '').trim(), normalizeRole(role), String(address || '').trim()]]
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!A${sheetRow}:E${sheetRow}`,
    // RAW for the same reason as addEmployee: preserve leading zeros in phones.
    valueInputOption: 'RAW',
    requestBody: { values },
  })
  clearEmployeesCache()
  return true
}

export async function deleteEmployee(rowIndex: number) {
  const sid = ADMIN_SPREADSHEET_ID
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  const sheetId = await sheetIdFor(sheets, tab, sid)
  if (sheetId == null) throw new Error('Employees sheet not found')
  // Same as updateEmployee: resolve the physical row from the non-empty data
  // rows so blank gap rows don't shift the delete onto the wrong member.
  const rows = await readEmployeesGrid(sheets, tab)
  const dataRows = memberDataRowIndexes(rows)
  const target = dataRows[rowIndex]
  if (target === undefined) throw new Error(`Member row ${rowIndex} not found in the ${tab} sheet`)
  const sheetRow = target + 1
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }],
    },
  })
  clearEmployeesCache()
  return true
}

/* ---- Holidays (admin spreadsheet 'Holiday List' tab) ----
 * Column A holds the date (a real date cell, or a typed date string) and
 * column B an optional holiday name. Those dates are marked 'Holiday' in every
 * month tab and block attendance submission for everyone.
 */
const HOLIDAYS_SHEET = (process.env.HOLIDAYS_SHEET_TAB || 'Holiday List').trim() || 'Holiday List'

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

let holidaysCache: Map<string, string> | null = null
let holidaysCacheAt = 0
const HOLIDAYS_CACHE_TTL = 60 * 1000

/** Is this tab the holiday list (never a month tab)? */
export function isHolidaysTab(title: string) {
  return String(title || '').trim().toLowerCase() === HOLIDAYS_SHEET.toLowerCase()
}

/** 'YYYY-MM-DD' key used by the holiday map. */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthFromName(name: string): number {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return -1
  return MONTH_NAMES.findIndex((full) => full === key || full.startsWith(key.slice(0, 3)))
}

/**
 * Google Sheets / Excel serial date → calendar day. Serials below 61 are
 * rejected because that range is where Excel's fake 1900 leap day lives (and a
 * plain day-of-month would otherwise look like a serial).
 */
export function serialToYmd(serial: number): { year: number; month: number; day: number } | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 3000000) return null
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 24 * 60 * 60 * 1000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** Parses one holiday date cell (serial number or typed date string). */
function parseHolidayDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value === 'number') return serialToYmd(value)
  const raw = String(value ?? '').trim()
  if (!raw) return null

  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) // 2026-09-20
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }

  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/) // 09-20-2026 / 20-09-2026
  if (m) {
    const first = Number(m[1])
    const second = Number(m[2])
    // The sheet writes dates month-first, so only swap when the first number
    // can't be a month.
    const month = first > 12 ? second : first
    const day = first > 12 ? first : second
    return { year: Number(m[3]), month, day }
  }

  m = raw.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/) // 20 September 2026
  if (m) {
    const mi = monthFromName(m[2])
    return mi === -1 ? null : { year: Number(m[3]), month: mi + 1, day: Number(m[1]) }
  }

  m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/) // September 20, 2026
  if (m) {
    const mi = monthFromName(m[1])
    return mi === -1 ? null : { year: Number(m[3]), month: mi + 1, day: Number(m[2]) }
  }

  return null
}

/**
 * Holiday dates (admin spreadsheet) as a map of 'YYYY-MM-DD' -> holiday name.
 * Cached briefly so page loads don't re-read the tab every time.
 */
export async function getHolidays({ forceRefresh = false } = {}): Promise<Map<string, string>> {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) return new Map()
  const now = Date.now()
  if (!forceRefresh && holidaysCache && now - holidaysCacheAt < HOLIDAYS_CACHE_TTL) return holidaysCache

  try {
    const sheets = await sheetsClient()
    const tabs: string[] = await listTabs(sheets)
    const tab = tabs.find((t) => isHolidaysTab(t))
    const map = new Map<string, string>()
    if (tab) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: ADMIN_SPREADSHEET_ID,
        range: `${tab}!A2:B400`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      })
      for (const row of res.data.values || []) {
        const ymd = parseHolidayDate(row?.[0])
        if (!ymd) continue
        map.set(dateKey(ymd.year, ymd.month, ymd.day), String(row?.[1] ?? '').trim())
      }
    } else {
      console.warn(`Holiday tab "${HOLIDAYS_SHEET}" not found — no holidays applied.`)
    }
    holidaysCache = map
    holidaysCacheAt = now
    return map
  } catch (e) {
    console.warn('Holiday list read failed:', (e as Error).message)
    return holidaysCache || new Map()
  }
}

export function clearHolidaysCache() {
  holidaysCache = null
  holidaysCacheAt = 0
}

/** Today's holiday (Asia/Dhaka), when today is on the holiday list. */
export async function getTodayHoliday(): Promise<{ date: string; name: string } | null> {
  const { year, month, day } = nowParts()
  const key = dateKey(year, month, day)
  const holidays = await getHolidays()
  if (!holidays.has(key)) return null
  return { date: key, name: holidays.get(key) || 'Holiday' }
}

/** Holiday names for one month, keyed by day number (for the history calendar). */
export async function getHolidaysInMonth(year: number, month: number): Promise<Record<string, string>> {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`
  const out: Record<string, string> = {}
  for (const [key, name] of await getHolidays()) {
    if (key.startsWith(prefix)) out[String(Number(key.slice(8, 10)))] = name
  }
  return out
}

/** 'September 2026' (as created by monthLabel) → { year, month }. */
function parseMonthTabTitle(title: string): { year: number; month: number } | null {
  const m = String(title || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!m) return null
  const mi = monthFromName(m[1])
  return mi === -1 ? null : { year: Number(m[2]), month: mi + 1 }
}

export function nowParts() {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date())

  return {
    date: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    month: Number(fmt({ month: 'numeric' })),
    year: Number(fmt({ year: 'numeric' })),
    day: Number(fmt({ day: 'numeric' })),
    time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function weekdayShort(year: number, month: number, day: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(year, month - 1, day, 12, 0, 0))
}

function columnLetter(index: number) {
  let letter = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

/* ---- structure detection ---- */

function isAttendanceStructure(rows: any[], headerRow: number) {
  const row = rows[headerRow] || []
  for (let i = 2; i < Math.min(8, row.length); i++) {
    const h = String(row[i] || '').trim().toLowerCase()
    if (h === 'presence' || h === 'status') return true
  }
  return false
}

/** Previous format: Presence holds the pure status, the second column is Time. */
function isPresenceTimeFormat(rows: any[], headerRow: number) {
  const row = rows[headerRow] || []
  for (let i = 3; i < Math.min(10, row.length); i++) {
    if (String(row[i] || '').trim().toLowerCase() === 'time') return true
  }
  return false
}

/** Splits a merged presence cell ('On-site - 9:00 AM') into status + time. */
function splitPresence(value: unknown): { status: string; time: string } {
  const raw = String(value ?? '').trim()
  const dashIdx = raw.lastIndexOf(' - ')
  if (dashIdx === -1) return { status: raw, time: '' }
  return { status: raw.substring(0, dashIdx).trim(), time: raw.substring(dashIdx + 3).trim() }
}

/** Legacy detection: true 3-col blocks (Presence/Time/Location).
 * Must require BOTH markers — the Presence/Location format also has a 'Location'
 * header, and matching that alone made the auto-absent fill stride 3 columns and
 * misalign every employee after the first. */
function isLegacyThreeCol(rows: any[], headerRow: number) {
  const row = rows[headerRow] || []
  let hasTime = false
  let hasLocation = false
  for (let i = 2; i < Math.min(12, row.length); i++) {
    const h = String(row[i] || '').trim().toLowerCase()
    if (h === 'time') hasTime = true
    if (h === 'location') hasLocation = true
  }
  return hasTime && hasLocation
}

/* ---- migrate: Presence + Time format → merged 'Status - Time' + Location ---- */

/**
 * Rewrites a tab from the previous format (Presence = pure status, Time column)
 * into the current one (Presence = 'Status - Time', Location column).
 * The old time is folded into the merged presence; the Time header becomes
 * Location and the location cells start empty. No-op if the tab already uses
 * the Presence/Location format.
 */
async function migratePresenceTimeToMerged(sheets: any, tab: string, store?: unknown) {
  const sid = spreadsheetIdForStore(store ?? 'admin')
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  if (!isPresenceTimeFormat(rows, headerRow)) return false
  // A true legacy 3-col tab (Presence/Time/Location) also carries a 'Time'
  // header — leave it alone so its layout is never collapsed.
  if (isLegacyThreeCol(rows, headerRow)) return false

  for (let i = 3; i < (rows[headerRow]?.length ?? 0); i++) {
    if (String(rows[headerRow][i] || '').trim().toLowerCase() === 'time') {
      rows[headerRow][i] = 'Location'
    }
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    for (let c = 2; c < row.length; c += 2) {
      const status = String(row[c] ?? '').trim()
      if (!status) continue
      const time = String(row[c + 1] ?? '').trim()
      // Fold the old Time column into the presence cell; the second column is
      // now Location, so it always starts empty.
      row[c] = time ? `${status} - ${time}` : status
      row[c + 1] = ''
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  })
  console.log(`Migrated tab "${tab}" from Presence+Time to merged 'Status - Time'+Location`)
  return true
}

/* ---- createTab with Timestamp row + Date/Day/Presence/Location headers ---- */

async function createTab(sheets: any, title: string, year: number, month: number, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: {
      requests: [{ addSheet: { properties: { title, gridProperties: { columnCount: 50 } } } }],
    },
  })

  const daysInMonth = new Date(year, month, 0).getDate()
  const totalRow = daysInMonth + 3

  const dateDayRow = ['Date', 'Day']
  const timestampRow = Array(dateDayRow.length).fill('')
  timestampRow[0] = 'Timestamp'
  const values = [
    timestampRow,
    dateDayRow,
    ...Array.from({ length: daysInMonth }, (_, i) => [String(i + 1), weekdayShort(year, month, i + 1)]),
    [ABSENT_SECTION, ''],
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${title}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })

  await boldCells(sheets, title, [
    { row: 0, col: 0 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: totalRow - 1, col: 0 },
  ], normalizedStore)

  await applyEmployeeFormatting(sheets, title, normalizedStore)

  // Pre-populate one Presence/Location column block for every member OF THIS STORE
  // so a new month tab is immediately usable by the whole group (no first-login
  // wait), then auto-fill past days (Absent with AUTO_ABSENT_TIME, Fridays
  // Holiday) and write the Absent Days COUNTIF summary for everyone.
  try {
    const members = await getEmployees({ forceRefresh: true })
    const storeMembers = members.filter((m: { role?: string }) => {
      const r = normalizeRole(m?.role || '')
      if (normalizedStore === 'bootcamp') return r === 'Bootcamp'
      if (normalizedStore === 'employee') return r === 'Employee'
      return r === 'Admin'
    })
    const added = await addAllEmployeeColumns(sheets, title, storeMembers, normalizedStore)
    if (added > 0 || storeMembers.length) {
      const filled = await sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range: title,
        valueRenderOption: 'FORMATTED_VALUE',
      })
      const rows = filled.data.values || []
      await markAbsentForPastDays(sheets, title, rows, normalizedStore)
      await updateAbsentSummary(sheets, title, rows, normalizedStore)
    }
  } catch (e) {
    console.warn(`Member pre-population skipped for "${title}":`, (e as Error).message)
  }

  console.log(`Created attendance tab "${title}" (${daysInMonth} days, 2-col with Timestamp row)`)
  return title
}

/**
 * Adds Presence/Location blocks for ALL given members in ONE batched pass
 * (1 read + 1 column expansion + 1 batch write + 1 formatting pass),
 * unlike per-member ensureEmployeeColumn calls which hit the Sheets read quota.
 * Returns how many columns were added.
 */
async function addAllEmployeeColumns(sheets: any, tab: string, members: { name?: string; email?: string }[], store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const namesRow = findEmployeeNamesRow(rows, headerRow)

  const missing = members.filter((m) => {
    const email = String(m?.email || '').trim().toLowerCase()
    return email && findEmployeeColumnByEmail(rows, headerRow, email) === -1
  })
  if (!missing.length) return 0

  let startCol = Math.max(rows[namesRow].length, rows[headerRow].length, 2)
  const neededCols = startCol + missing.length * COLS_PER_EMPLOYEE + 2
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sid })
  const sheetProps = sheetMeta.data.sheets?.find((s: any) => s.properties?.title === tab)
  const currentCols = sheetProps?.properties?.gridProperties?.columnCount || 26
  if (neededCols > currentCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: {
        requests: [{ updateSheetProperties: { properties: { sheetId: sheetProps?.properties?.sheetId, gridProperties: { columnCount: neededCols } }, fields: 'gridProperties.columnCount' } }],
      },
    })
  }

  const data: { range: string; values: any[][] }[] = []
  for (const m of missing) {
    const email = String(m?.email || '').trim().toLowerCase()
    const name = String(m?.name || '').trim() || email.split('@')[0]
    data.push({ range: `${tab}!${columnLetter(startCol)}${namesRow + 1}`, values: [[formatEmployeeHeader(name, email)]] })
    data.push({ range: `${tab}!${columnLetter(startCol)}${headerRow + 1}:${columnLetter(startCol + 1)}${headerRow + 1}`, values: [['Presence', 'Location']] })
    startCol += COLS_PER_EMPLOYEE
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })

  await applyEmployeeFormatting(sheets, tab, normalizedStore)
  console.log(`Added ${missing.length} employee column block(s) to "${tab}" in one batch`)
  return missing.length
}

async function ensureMonthTab(sheets: any, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const tabs = await listTabs(sheets, sid)
  const { year, month } = nowParts()
  const title = SHEET_TAB || monthLabel(year, month)
  if (tabs.includes(title)) return title
  return createTab(sheets, title, year, month, normalizedStore)
}

function findHeaderRow(rows: any[]) {
  const idx = rows.findIndex((row) => String(row[0] || '').trim() === 'Date')
  if (idx === -1) throw new Error('No header row with "Date" found in the sheet')
  return idx
}

function findDayRow(rows: any[], headerRow: number, day: any) {
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === String(day)) return i
  }
  throw new Error(`No row for day ${day} found in the sheet`)
}

function parseHeaderEmail(header: string): string | null {
  const h = String(header || '').trim()
  const m = h.match(/<([^>]+@[^>]+)>/)
  if (m) return m[1].trim().toLowerCase()
  if (h.includes('@') && !h.includes(' ') && h.includes('.')) return h.trim().toLowerCase()
  return null
}

function parseHeaderName(header: string): string {
  const h = String(header || '').trim()
  const m = h.match(/^([^<]+)<[^>]+>$/)
  if (m) return m[1].trim()
  return h
}

function formatEmployeeHeader(name: string, email: string) {
  const n = String(name || '').trim()
  const e = String(email || '').trim().toLowerCase()
  if (!e) return n
  if (parseHeaderEmail(n)) return n
  return `${n} <${e}>`
}

function findEmployeeNamesRow(rows: any[], headerRow: number) {
  if (headerRow > 0 && rows[headerRow - 1]) {
    const rowAbove = rows[headerRow - 1]
    const firstCell = String(rowAbove[2] || '').trim()
    if (firstCell.includes('@')) return headerRow - 1
    const rowAboveFirst = String(rowAbove[0] || '').trim().toLowerCase()
    if (rowAboveFirst === 'timestamp') return headerRow - 1
    const header = rows[headerRow] || []
    if (String(header[2] || '').trim().toLowerCase() === 'presence') return headerRow - 1
  }
  return headerRow
}

function findEmployeeColumnByEmail(rows: any[], headerRow: number, email: string) {
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const headers = rows[namesRow]
  const target = String(email || '').trim().toLowerCase()
  if (!target) return -1
  const step = isAttendanceStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
  for (let i = 2; i < headers.length; i += step) {
    const parsed = parseHeaderEmail(headers[i])
    if (parsed && parsed === target) return i
  }
  return -1
}

function findEmployeeColumnLegacyByName(rows: any[], headerRow: number, name: string) {
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const headers = rows[namesRow]
  const target = String(name || '').trim().toLowerCase()
  if (!target) return -1
  const step = isAttendanceStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
  for (let i = 2; i < headers.length; i += step) {
    const h = String(headers[i] || '').trim()
    if (!h) continue
    if (parseHeaderName(h).toLowerCase() === target) return i
    if (h.toLowerCase() === target) return i
  }
  return -1
}

function findEmployeeColumn(rows: any[], headerRow: number, employeeName: string, employeeEmail?: string) {
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  // Always try email first — emails are unique identifiers
  if (employeeEmail) {
    const byEmail = findEmployeeColumnByEmail(rows, headerRow, employeeEmail)
    if (byEmail !== -1) return byEmail
    // Email provided but not found — don't fall back to name (name may belong to another user)
    const key = employeeEmail || employeeName
    throw new Error(
      `Employee "${key}" not found in the sheet headers. ` +
      'Add a column with that exact name, or fix the name in lib/employees.',
    )
  }
  // No email — fall back to name matching (only safe when email is not available)
  if (employeeName) {
    const byName = findEmployeeColumnLegacyByName(rows, headerRow, employeeName)
    if (byName !== -1) return byName
    const headers = rows[namesRow]
    const step = isAttendanceStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
    const target = String(employeeName).trim().toLowerCase()
    const idx = headers.findIndex(
      (h: any) => String(h || '').trim().toLowerCase() === target || parseHeaderName(String(h || '').trim()).toLowerCase() === target,
    )
    if (idx !== -1) return idx
  }
  const key = employeeEmail || employeeName
  throw new Error(
    `Employee "${key}" not found in the sheet headers. ` +
    'Add a column with that exact name, or fix the name in lib/employees.',
  )
}

/**
 * Ensures employee column exists. For attendance structure, adds 2 columns at once
 * (Presence/Location) with sub-header row.
 */
async function ensureEmployeeColumn(sheets: any, tab: string, employeeName: string, employeeEmail?: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const email = String(employeeEmail || '').trim().toLowerCase()
  const name = String(employeeName || '').trim()
  if (!email && !name) throw new Error('employeeName or employeeEmail required')

  let res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  let rows = res.data.values || []
  let headerRow = findHeaderRow(rows)
  const namesRow = findEmployeeNamesRow(rows, headerRow)

  if (email && findEmployeeColumnByEmail(rows, headerRow, email) !== -1) return

  if (email && name) {
    const legacyIdx = findEmployeeColumnLegacyByName(rows, headerRow, name)
    if (legacyIdx !== -1) {
      const existingEmail = parseHeaderEmail(rows[namesRow][legacyIdx] || '')
      // Only claim legacy column if it has no email yet (truly unclaimed)
      if (!existingEmail) {
        const newHeader = formatEmployeeHeader(rows[namesRow][legacyIdx] || name, email)
        const range = `${tab}!${columnLetter(legacyIdx)}${namesRow + 1}`
        await sheets.spreadsheets.values.update({
          spreadsheetId: sid,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[newHeader]] },
        })
        console.log(`Claimed legacy column for "${email}" -> "${newHeader}" in "${tab}"`)
        return
      }
    }
  }

  if (name && !email) {
    const existsName = rows[namesRow].some((h: any) => parseHeaderName(String(h || '').trim()).toLowerCase() === name.toLowerCase())
    if (existsName) return
  }

  const hasExistingEmpCols = (rows[headerRow]?.length ?? 0) > 2
  const isNew = isAttendanceStructure(rows, headerRow) || !hasExistingEmpCols
  const newHeader = email ? formatEmployeeHeader(name || email, email) : name

  if (isNew) {
    const startCol = Math.max(rows[namesRow].length, rows[headerRow].length, 2)
    // Expand sheet columns if needed (default is 26 = A-Z)
    const neededCols = startCol + COLS_PER_EMPLOYEE + 2
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sid })
    const sheetProps = sheetMeta.data.sheets?.find((s: any) => s.properties?.title === tab)
    const currentCols = sheetProps?.properties?.gridProperties?.columnCount || 26
    if (neededCols > currentCols) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        requestBody: {
          requests: [{ updateSheetProperties: { properties: { sheetId: sheetProps?.properties?.sheetId, gridProperties: { columnCount: neededCols } }, fields: 'gridProperties.columnCount' } }],
        },
      })
      console.log(`Expanded "${tab}" from ${currentCols} to ${neededCols} columns`)
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${tab}!${columnLetter(startCol)}${namesRow + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader]] },
    })
    const headerCells = rows[headerRow] || []
    if (String(headerCells[startCol] || '').trim().toLowerCase() !== 'presence') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${tab}!${columnLetter(startCol)}${headerRow + 1}:${columnLetter(startCol + 1)}${headerRow + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Presence', 'Location']] },
      })
    }
    await applyEmployeeFormatting(sheets, tab, normalizedStore)
    console.log(`Added employee 2-col "${newHeader}" to "${tab}" at col ${startCol}`)
  } else {
    const range = `${tab}!${columnLetter(rows[namesRow].length)}${namesRow + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader]] },
    })
    console.log(`Added employee column "${newHeader}" to "${tab}"`)
  }
}

/** Fills empty cells for past days with "Absent - 12:00 AM" (for 2-col) or "Holiday" for Fridays. */
async function markAbsentForPastDays(sheets: any, tab: string, rows: any[], store?: unknown) {
  const sid = spreadsheetIdForStore(store ?? 'admin')
  const { day: today } = nowParts()
  const headerRow = findHeaderRow(rows)
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const firstEmployeeCol = 2
  const lastEmployeeCol = rows[headerRow].length
  const isAtt = isAttendanceStructure(rows, headerRow)
  const isLegacy3 = isLegacyThreeCol(rows, headerRow)

  if (namesRow < headerRow) {
    while (rows[namesRow].length < lastEmployeeCol) rows[namesRow].push('')
  }

  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const v = String(rows[i][j] || '').trim()
      if (v === 'Not Available') {
        rows[i][j] = 'N/A'
      }
    }
  }

  // Holidays come from the admin spreadsheet's 'Holiday List' tab, matched
  // against the month this tab holds. A tab whose name isn't a month label
  // (e.g. a pinned ATTENDANCE_SHEET_TAB) can't be matched, so it only gets the
  // Friday rule.
  const tabMonth = parseMonthTabTitle(tab)
  const holidays = tabMonth ? await getHolidays() : new Map<string, string>()

  // Advance one full employee block per iteration (2 cols for Presence+Location,
  // 3 for legacy) so a filled pair is never re-read as an empty Presence cell —
  // stepping by 1 used to misalign Fridays after the first pass.
  const fillStep = isLegacy3 ? 3 : isAtt ? COLS_PER_EMPLOYEE : 1
  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    const dayName = String(rows[i][1] || '').trim()
    const listed = tabMonth ? holidays.get(dateKey(tabMonth.year, tabMonth.month, day)) : undefined

    if (dayName === 'Fri' || listed !== undefined) {
      // A listed holiday is marked for the whole month up front; future Fridays
      // are left alone until they arrive.
      if (listed === undefined && day >= today) continue
      for (let c = firstEmployeeCol; c < lastEmployeeCol; c += fillStep) {
        // A listed holiday is authoritative: it replaces whatever was recorded
        // for that date. A plain Friday only fills cells that are still empty.
        if (listed === undefined && String(rows[i][c] ?? '').trim() !== '') continue
        rows[i][c] = 'Holiday'
        if (isLegacy3) {
          rows[i][c + 1] = ''
          rows[i][c + 2] = ''
        } else if (isAtt) {
          rows[i][c + 1] = ''
        }
      }
      continue
    }

    if (day >= today) continue
    for (let c = firstEmployeeCol; c < lastEmployeeCol; c += fillStep) {
      const current = String(rows[i][c] ?? '').trim()
      if (current === '') {
        if (isLegacy3) {
          // Legacy 3-col: status, time, location
          rows[i][c] = 'Absent'
          rows[i][c + 1] = AUTO_ABSENT_TIME
          rows[i][c + 2] = ABSENT_LOCATION
        } else if (isAtt) {
          // Presence/Location: merged 'Absent - <auto time>', Location defaults to N/A
          rows[i][c] = `Absent - ${AUTO_ABSENT_TIME}`
          rows[i][c + 1] = ABSENT_LOCATION
        } else {
          rows[i][c] = 'Absent'
        }
      } else if (
        isAtt &&
        !isLegacy3 &&
        splitPresence(current).status === 'Absent' &&
        String(rows[i][c + 1] ?? '').trim() === ''
      ) {
        // Backfill: absent days recorded before the N/A default get it now.
        rows[i][c + 1] = ABSENT_LOCATION
      }
    }
  }

  let lastDayRow = headerRow + 1
  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    lastDayRow = i
  }

  const dataRows = []
  for (let i = headerRow + 1; i <= lastDayRow; i++) {
    const row = [...(rows[i] || [])]
    while (row.length < lastEmployeeCol) row.push('')
    dataRows.push(row.slice(0, lastEmployeeCol))
  }

  if (dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${tab}!A${headerRow + 2}:${columnLetter(lastEmployeeCol - 1)}${headerRow + 1 + dataRows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows },
    })
  }
  console.log(`Marked holidays/Absent for past days in "${tab}"`)
}

async function updateAbsentSummary(sheets: any, tab: string, rows: any[], store?: unknown) {
  const sid = spreadsheetIdForStore(store ?? 'admin')
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]
  const is3col = isAttendanceStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const employeeCols: number[] = []
  for (let c = 2; c < headers.length; c += step) {
    if (String(headers[c] ?? '').trim()) employeeCols.push(c)
  }

  // Find last day row to determine the range for COUNTIF
  let lastDayRow = headerRow
  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    lastDayRow = i
  }

  let titleRow = -1
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] ?? '').trim() === ABSENT_SECTION) {
      titleRow = i
      break
    }
  }
  if (titleRow === -1) titleRow = rows.length

  // Build absent row with COUNTIF formulas per employee
  const totalCols = rows[headerRow].length
  const absentRow: string[] = [ABSENT_SECTION, '']
  const firstDataRow = headerRow + 2 // row number in sheet (1-based)
  const lastDataRow = lastDayRow + 1 // row number in sheet (1-based)
  for (let c = 2; c < totalCols; c++) {
    if (employeeCols.includes(c)) {
      const colLetter = columnLetter(c)
      absentRow.push(`=COUNTIF(${colLetter}${firstDataRow}:${colLetter}${lastDataRow},"Absent*")`)
    } else {
      absentRow.push('')
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!A${titleRow + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [absentRow] },
  })

  await boldCells(sheets, tab, [
    { row: titleRow, col: 0 },
  ], store)
}

async function boldCells(sheets: any, tab: string, cells: { row: number; col: number }[], store?: unknown) {
  const sid = spreadsheetIdForStore(store ?? 'admin')
  const sheetId = await sheetIdFor(sheets, tab, sid)
  if (sheetId == null) return
  const requests = cells.map(({ row, col }) => ({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: row,
        endRowIndex: row + 1,
        startColumnIndex: col,
        endColumnIndex: col + 1,
      },
      rows: [{ values: [{ userEnteredFormat: { textFormat: { bold: true } } }] }],
      fields: 'userEnteredFormat.textFormat.bold',
    },
  }))
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: { requests },
  })
}

const EMP_COLORS = [
  { red: 1, green: 0.949, blue: 0.8 },
  { red: 0.988, green: 0.898, blue: 0.804 },
  { red: 0.851, green: 0.918, blue: 0.827 },
  { red: 0.816, green: 0.878, blue: 0.89 },
]
const PINK_COLOR = { red: 0.918, green: 0.82, blue: 0.863 }
/** Google Sheets palette "light yellow 3" (#FFF2CC) — holidays and Fridays. */
const HOLIDAY_YELLOW = { red: 1, green: 0.949, blue: 0.8 }
const SOLID_MEDIUM = { style: 'SOLID_MEDIUM' }

async function applyEmployeeFormatting(sheets: any, tab: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheetId = await sheetIdFor(sheets, tab, sid)
  if (sheetId == null) return

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const numEmps = Math.max(0, Math.floor((rows[headerRow].length - 2) / COLS_PER_EMPLOYEE))
  if (numEmps === 0) return

  let lastDayRow = headerRow
  for (let i = headerRow + 1; i < rows.length; i++) {
    const d = Number(rows[i][0])
    if (!Number.isInteger(d)) break
    lastDayRow = i
  }
  const absentRowIdx = lastDayRow + 1

  const requests = []

  function bgCells(row: number, colStart: number, colEnd: number, color: { red: number; green: number; blue: number }) {
    const vals = []
    for (let c = colStart; c < colEnd; c++) {
      vals.push({ userEnteredFormat: { backgroundColorStyle: { rgbColor: color } } })
    }
    return {
      updateCells: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: colStart, endColumnIndex: colEnd },
        rows: [{ values: vals }],
        fields: 'userEnteredFormat.backgroundColorStyle',
      },
    }
  }

  function bdrCell(row: number, col: number, sides: string[]) {
    const req: any = { updateBorders: { range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 } } }
    for (const s of sides) req.updateBorders[s] = SOLID_MEDIUM
    return req
  }

  function bdrRange(r1: number, r2: number, c1: number, c2: number, sides: string[]) {
    const req: any = { updateBorders: { range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 } } }
    for (const s of sides) req.updateBorders[s] = SOLID_MEDIUM
    return req
  }

  requests.push(bgCells(0, 0, 2, PINK_COLOR))
  requests.push(bgCells(1, 0, 2, PINK_COLOR))

  for (let i = 0; i < numEmps; i++) {
    const sc = 2 + i * COLS_PER_EMPLOYEE
    const ec = sc + COLS_PER_EMPLOYEE
    const color = EMP_COLORS[i % EMP_COLORS.length]

    requests.push(bgCells(0, sc, ec, color))
    requests.push(bgCells(1, sc, ec, color))

    // Row 0 (names row): only top border on first col, right border on last col
    requests.push(bdrCell(0, sc, ['top', 'left']))
    if (i === numEmps - 1) requests.push(bdrCell(0, ec - 1, ['top', 'right']))

    requests.push(bdrCell(1, ec - 1, ['right']))
    if (i === 0) requests.push(bdrCell(1, sc, ['left']))
  }

  // Bold all employee sub-header cells in row 1 (Date/Day/Presence/Location)
  const boldRow1: { row: number; col: number }[] = [{ row: 1, col: 0 }, { row: 1, col: 1 }]
  for (let i = 0; i < numEmps; i++) {
    const sc = 2 + i * COLS_PER_EMPLOYEE
    for (let c = sc; c < sc + COLS_PER_EMPLOYEE; c++) {
      boldRow1.push({ row: 1, col: c })
    }
  }
  await boldCells(sheets, tab, boldRow1, normalizedStore)

  // Holidays are shaded like Fridays: every Friday plus every date on the
  // admin spreadsheet's 'Holiday List' gets the light yellow 3 background.
  const tabMonth = parseMonthTabTitle(tab)
  const holidays = tabMonth ? await getHolidays() : new Map<string, string>()
  const totalCols = 2 + numEmps * COLS_PER_EMPLOYEE

  for (let r = headerRow + 1; r <= lastDayRow; r++) {
    const dayName = String(rows[r][1] || '').trim()
    const day = Number(rows[r][0])
    const listed = tabMonth && Number.isInteger(day) ? holidays.get(dateKey(tabMonth.year, tabMonth.month, day)) : undefined
    if (dayName === 'Fri' || listed !== undefined) {
      requests.push(bgCells(r, 0, totalCols, HOLIDAY_YELLOW))
    }
    for (let i = 0; i < numEmps; i++) {
      const sc = 2 + i * COLS_PER_EMPLOYEE
      const ec = sc + COLS_PER_EMPLOYEE
      requests.push(bdrCell(r, sc, ['left']))
      requests.push(bdrCell(r, ec - 1, ['right']))
    }
  }

  for (let i = 0; i < numEmps; i++) {
    const sc = 2 + i * COLS_PER_EMPLOYEE
    const ec = sc + COLS_PER_EMPLOYEE
    for (let c = sc; c < ec; c++) {
      requests.push(bdrCell(lastDayRow, c, ['bottom']))
    }
    requests.push(bdrRange(absentRowIdx, absentRowIdx + 1, sc, ec, ['top', 'bottom', 'left', 'right']))
  }

  // Set wrapStrategy CLIP on all data cells to prevent overflow
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: lastDayRow + 2, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
      fields: 'userEnteredFormat.wrapStrategy',
    },
  })

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests },
    })
  }
  console.log(`Applied formatting to "${tab}" (${numEmps} employees)`)
}

let migratedTabs = new Set<string>()
// Tabs already repainted in this server process (see loadGrid).
let paintedTabs = new Set<string>()

async function loadGrid(sheets: any, tab: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  // One-time auto-migration: Presence + Time → merged 'Status - Time' + Location.
  // Guarded per spreadsheet+tab so page loads don't re-check every time.
  const migratedKey = `${sid}::${tab}`
  if (!migratedTabs.has(migratedKey)) {
    migratedTabs.add(migratedKey)
    if (isPresenceTimeFormat(rows, findHeaderRow(rows))) {
      try {
        await migratePresenceTimeToMerged(sheets, tab, normalizedStore)
        return await loadGrid(sheets, tab, normalizedStore) // re-read the migrated grid
      } catch (e) {
        console.warn(`Migration skipped for "${tab}":`, (e as Error).message)
      }
    }
  }
  await markAbsentForPastDays(sheets, tab, rows, normalizedStore)
  await updateAbsentSummary(sheets, tab, rows, normalizedStore)

  // The holiday/Friday shading only lives in the tab's formatting, which is
  // otherwise refreshed just when columns change. Repaint each tab once per
  // process so existing tabs pick up the current colours (and newly listed
  // holidays) without paying for a full formatting pass on every page load.
  const paintKey = `${sid}::${tab}`
  if (!paintedTabs.has(paintKey)) {
    paintedTabs.add(paintKey)
    try {
      await applyEmployeeFormatting(sheets, tab, normalizedStore)
    } catch (e) {
      console.warn(`Holiday shading skipped for "${tab}":`, (e as Error).message)
    }
  }
  return rows
}

/**
 * Returns { attended, status, time?, location? } for an employee on a given day.
 * Routes to the member's store sheet (Admin / Employee / Bootcamp) via the
 * Members directory, unless an explicit store is given.
 */
export async function getAttendance(employeeName: string, employeeEmail?: string, day?: number | string, store?: unknown) {
  if (day === undefined) {
    const maybeDay = employeeEmail
    const isDay = typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    if (isDay) {
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const normalizedStore = store === undefined
    ? await storeForEmail(String(employeeEmail || ''))
    : normalizeStore(store)
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const tab = await ensureMonthTab(sheets, normalizedStore)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail, normalizedStore)
  const rows = await loadGrid(sheets, tab, normalizedStore)
  const headerRow = findHeaderRow(rows)
  const isAtt = isAttendanceStructure(rows, headerRow)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  if (isAtt) {
    const presence = String(rows[rowIdx][colIdx] ?? '').trim()
    if (!presence) return { attended: false }
    // Presence holds 'Status - Time'; the next column holds the location.
    const { status, time } = splitPresence(presence)
    const location = String(rows[rowIdx][colIdx + 1] ?? '').trim()
    return { attended: true, status, time, location }
  }
  const status = String(rows[rowIdx][colIdx] ?? '').trim()
  return status ? { attended: true, status } : { attended: false }
}

/**
 * Writes attendance for the employee on a day.
 * Presence column = 'Status - Time' (merged), Location column = road, district.
 * Routes to the member's store sheet unless an explicit store is given.
 */
export async function markAttendance(employeeName: string, employeeEmail?: string, day?: number | string, status?: string, time?: string, location?: string, store?: unknown) {
  if (status === undefined) {
    const maybeDay = employeeEmail
    const maybeStatus = day
    const isDay = typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    const isStatus = typeof maybeStatus === 'string' && ['', 'On-site', 'Remote', 'Absent'].includes(String(maybeStatus).trim())
    if (isDay && isStatus) {
      status = maybeStatus
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const normalizedStore = store === undefined
    ? await storeForEmail(String(employeeEmail || ''))
    : normalizeStore(store)
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const tab = await ensureMonthTab(sheets, normalizedStore)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail, normalizedStore)

  let rows = await loadGrid(sheets, tab, normalizedStore)
  let headerRow = findHeaderRow(rows)
  // The previous format (Presence = pure status + a Time column) also satisfies
  // isAttendanceStructure, so migrate whenever its Time header is detected —
  // not just when the Presence header is missing.
  if (isPresenceTimeFormat(rows, headerRow)) {
    const migrated = await migratePresenceTimeToMerged(sheets, tab, normalizedStore)
    if (migrated) {
      rows = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: tab, valueRenderOption: 'FORMATTED_VALUE' }).then(r => r.data.values || [])
      headerRow = findHeaderRow(rows)
    }
  }
  const isNew = isAttendanceStructure(rows, headerRow)

  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  const t = String(time || '').trim() || new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
  const statusValue = String(status || '').trim()
  const loc = String(location || '').trim()
  const presence = statusValue ? `${statusValue}${t ? ` - ${t}` : ''}` : ''
  const locValue = statusValue === 'Absent' && !loc ? ABSENT_LOCATION : loc

  if (isNew) {
    const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`
    const written = await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[presence, presence ? locValue : '']] },
    })
    return (written.data.updatedCells ?? 0) > 0
  }

  const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}`
  const written = await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[presence]] },
  })
  return (written.data.updatedCells ?? 0) > 0
}

export { parseHeaderEmail, parseHeaderName, formatEmployeeHeader }

export async function listMonthTabs(store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sheets = await sheetsClient(spreadsheetIdForStore(normalizedStore))
  const tabs: string[] = await listTabs(sheets, spreadsheetIdForStore(normalizedStore))
  // The holiday list lives in the admin spreadsheet but is not an attendance
  // month — keep it out of the admin tab pickers.
  return tabs.filter((t) => !isHolidaysTab(t))
}

export async function getRawSheet(tab: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  let title = (tab || '').trim()
  if (!title) title = await ensureMonthTab(sheets, normalizedStore)
  else {
    const tabs = await listTabs(sheets, sid)
    if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  return { tab: title, values: res.data.values || [] }
}

export async function updateRawCell(tab: string, row: number, col: number, value: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const range = `${title}!${columnLetter(col)}${row + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[String(value ?? '')]] },
  })
  return true
}

export async function batchUpdateRawCells(tab: string, cells: { row: number; col: number; value: string }[], store?: unknown) {
  if (!cells?.length) return true
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const data = cells.map(({ row, col, value }) => ({
    range: `${title}!${columnLetter(col)}${row + 1}`,
    values: [[String(value ?? '')]],
  }))
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
  return true
}

export async function batchUpdateAttendanceCells(tab: string, updates: { employeeName?: string; employeeEmail?: string; name?: string; email?: string; day: string; status: string; time?: string; location?: string }[], store?: unknown) {
  if (!updates?.length) return true
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const is3col = isAttendanceStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const allowed = ['', 'On-site', 'Remote', 'Absent']

  const data = []
  const batchNamesRow = findEmployeeNamesRow(rows, headerRow)
  for (const u of updates) {
    const employeeName = String(u.employeeName || u.name || '').trim()
    const employeeEmail = String(u.employeeEmail || u.email || '').trim().toLowerCase()
    const day = String(u.day || '').trim()
    const normalized = String(u.status ?? '').trim()
    if (!allowed.includes(normalized)) {
      throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
    }
    // Strict isolation: never write another group's member into this store's tab.
    let checkEmail = employeeEmail
    if (!checkEmail && employeeName) {
      const hit = (rows[batchNamesRow] || []).find(
        (h: any) => parseHeaderName(String(h || '').trim()).toLowerCase() === employeeName.toLowerCase(),
      )
      checkEmail = parseHeaderEmail(String(hit || '')) || ''
    }
    await assertStoreMember(checkEmail, normalizedStore)
    const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
    const rowIdx = findDayRow(rows, headerRow, Number(day) || day)
    if (is3col) {
      // Merged presence col + Location col. The time is kept/deduced server-side:
      // an unchanged status keeps its recorded time, a new one gets the current
      // time (Absent gets AUTO_ABSENT_TIME) and clearing the status clears both
      // cells. A caller that doesn't send `location` keeps the stored one.
      const { status: existingStatus, time: existingTime } = splitPresence(rows[rowIdx]?.[colIdx])
      const existingLoc = String(rows[rowIdx]?.[colIdx + 1] ?? '').trim()
      let timeStr = String(u.time || '').trim()
      if (!normalized) {
        timeStr = ''
      } else if (!timeStr) {
        if (normalized === 'Absent') {
          timeStr = AUTO_ABSENT_TIME
        } else if (normalized !== existingStatus) {
          timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
        } else {
          timeStr = existingTime
        }
      }
      const presence = normalized ? `${normalized}${timeStr ? ` - ${timeStr}` : ''}` : ''
      const loc = u.location !== undefined ? String(u.location).trim() : existingLoc
      // Absent days default to N/A — only a location the editor actually typed
      // (not the value seeded from the sheet) is kept.
      const locValue = !normalized
        ? ''
        : normalized === 'Absent'
          ? u.location !== undefined && loc
            ? loc
            : ABSENT_LOCATION
          : loc
      data.push({
        range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`,
        values: [[presence, locValue]],
      })
    } else {
      data.push({
        range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}`,
        values: [[normalized]],
      })
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })

  const rows2Res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows2 = rows2Res.data.values || []
  await updateAbsentSummary(sheets, title, rows2, normalizedStore)
  return true
}

/**
 * Returns the full grid for a tab (for admin).
 * For 2-col: reads the merged Presence ('Status - Time') + Location per employee.
 */
export async function getAdminGrid(tab: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  let title = (tab || '').trim()
  if (!title) title = await ensureMonthTab(sheets, normalizedStore)
  else {
    const tabs = await listTabs(sheets, sid)
    if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  }
  const rows = await loadGrid(sheets, title, normalizedStore)
  const headerRow = findHeaderRow(rows)
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const headers = rows[headerRow]
  const is3col = isAttendanceStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const employees: string[] = []
  for (let c = 2; c < rows[namesRow].length; c += COLS_PER_EMPLOYEE) {
    const fullHeader = String(rows[namesRow][c] ?? '').trim()
    if (fullHeader) employees.push(fullHeader)
  }
  const isLegacy = isLegacyThreeCol(rows, headerRow)
  const days = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const raw = String(rows[i][0] ?? '').trim()
    if (raw === ABSENT_SECTION || raw.toLowerCase() === 'total') break
    const d = Number(raw)
    if (!Number.isInteger(d)) continue
    const values: Record<string, string> = {}
    const timeValues: Record<string, string> = {}
    const locationValues: Record<string, string> = {}
    for (const emp of employees) {
      const c = findEmployeeColumn(rows, headerRow, emp)
      if (isLegacy) {
        // Legacy 3-col: separate status, time, location
        values[emp] = String(rows[i][c] ?? '').trim()
        timeValues[emp] = String(rows[i][c + 1] ?? '').trim()
        locationValues[emp] = String(rows[i][c + 2] ?? '').trim()
      } else if (is3col) {
        // Current 2-col: merged 'Status - Time' in col, location in col+1.
        const { status, time } = splitPresence(rows[i][c])
        values[emp] = status
        timeValues[emp] = time
        locationValues[emp] = String(rows[i][c + 1] ?? '').trim()
      } else {
        values[emp] = String(rows[i][c] ?? '').trim()
      }
    }
    days.push({ date: raw, day: String(rows[i][1] ?? '').trim(), values, timeValues, locationValues })
  }
  let absentDays: Record<string, number> = {}
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] ?? '').trim() === ABSENT_SECTION) {
      for (const emp of employees) {
        const c = findEmployeeColumn(rows, headerRow, emp)
        absentDays[emp] = Number(rows[i][c] ?? 0) || 0
      }
      break
    }
  }
  return { tab: title, headers, employees, days, absentDays }
}

export async function adminUpdateCell(tab: string, employeeName: string, dayLabel: string, status: string, employeeEmail?: string, store?: unknown) {
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const is3col = isAttendanceStructure(rows, headerRow)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
  const rowIdx = findDayRow(rows, headerRow, Number(dayLabel) || dayLabel)

  // Strict isolation: never write another group's member into this store's tab.
  let checkEmail = String(employeeEmail || '').trim()
  if (!checkEmail && employeeName) {
    const namesRow = findEmployeeNamesRow(rows, headerRow)
    const hit = (rows[namesRow] || []).find(
      (h: any) => parseHeaderName(String(h || '').trim()).toLowerCase() === employeeName.toLowerCase(),
    )
    checkEmail = parseHeaderEmail(String(hit || '')) || ''
  }
  await assertStoreMember(checkEmail, normalizedStore)

  const allowed = ['', 'On-site', 'Remote', 'Absent']
  const normalized = String(status ?? '').trim()
  if (!allowed.includes(normalized)) {
    throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
  }

  if (is3col) {
    // Merged presence + Location: keep the stored time when the status is
    // unchanged, otherwise stamp the current time (Absent uses AUTO_ABSENT_TIME).
    // The recorded location is preserved.
    const existing = splitPresence(rows[rowIdx]?.[colIdx])
    let timeStr = ''
    if (normalized) {
      if (normalized === 'Absent') timeStr = AUTO_ABSENT_TIME
      else if (normalized === existing.status && existing.time) timeStr = existing.time
      else timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
    }
    const presence = normalized ? `${normalized}${timeStr ? ` - ${timeStr}` : ''}` : ''
    const loc = String(rows[rowIdx]?.[colIdx + 1] ?? '').trim()
    const locValue = !normalized ? '' : normalized === 'Absent' ? ABSENT_LOCATION : loc
    const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[presence, locValue]] },
    })
  } else {
    const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[normalized]] },
    })
  }

  const rows2Res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows2 = rows2Res.data.values || []
  await updateAbsentSummary(sheets, title, rows2, normalizedStore)
  return true
}

export async function backfillCurrentTab(store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) return
  // Backfill every configured store so auto-absent never drifts.
  const stores: StoreKind[] = store === undefined
    ? (['admin', 'employee', 'bootcamp'] as StoreKind[]).filter((s) => Boolean(spreadsheetIdForStore(s)))
    : [normalizeStore(store)]
  for (const s of stores) {
    try {
      const sid = spreadsheetIdForStore(s)
      const sheets = await sheetsClient(sid)
      const tab = await ensureMonthTab(sheets, s)
      await loadGrid(sheets, tab, s)
    } catch (e) {
      console.error(`Auto-absent backfill failed for "${s}":`, (e as Error).message)
    }
  }
}

export async function ensureEmployeeTabForUser(employeeName: string, employeeEmail: string) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) return
  const userStore = await storeForEmail(employeeEmail)
  const sid = spreadsheetIdForStore(userStore)
  const sheets = await sheetsClient(sid)
  const tab = await ensureMonthTab(sheets, userStore)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail, userStore)
  await loadGrid(sheets, tab, userStore)
}

/* ---- Admin maintenance helpers (rebuild / add column / refresh) ---- */

function parseMonthTitle(title: string): { year: number; month: number } | null {
  const m = title.trim().match(/^(.+?)\s+(\d{4})$/)
  if (!m) return null
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2000, i, 1))
    const long = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(d)
    const short = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d)
    if (long.toLowerCase() === m[1].toLowerCase() || short.toLowerCase() === m[1].toLowerCase()) {
      return { year: Number(m[2]), month: i + 1 }
    }
  }
  return null
}

/**
 * Deletes and re-creates an attendance tab in the canonical structure
 * (Timestamp row / names row / Date+Day+Presence+Location headers / Absent Days row),
 * then adds a 2-column block for every given employee and auto-fills
 * past days (Absent with AUTO_ABSENT_TIME, Fridays as Holiday).
 * Used to repair tabs that drifted into a legacy/mixed structure.
 */
export async function recreateAttendanceTab(tab: string, employees: { name: string; email: string }[], store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim()
  if (!title) throw new Error('Tab name required')

  const tabs = await listTabs(sheets, sid)
  if (tabs.includes(title)) {
    const sheetId = await sheetIdFor(sheets, title, sid)
    if (sheetId == null) throw new Error(`Sheet tab "${title}" not found`)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests: [{ deleteSheet: { sheetId } }] },
    })
  }

  const parsed = parseMonthTitle(title)
  const { year, month } = parsed || nowParts()
  await createTab(sheets, title, year, month, normalizedStore)

  // Strict isolation: only this store's role (unknown emails allowed).
  const expected = roleForStore(normalizedStore)
  const kept: { name: string; email: string }[] = []
  const dropped: string[] = []
  for (const e of employees) {
    const em = String(e?.email || '').trim()
    const role = em ? await getRoleForEmail(em) : null
    if (role && role !== expected) {
      dropped.push(`${String(e?.name || em)} (${role})`)
      continue
    }
    kept.push(e)
  }
  if (dropped.length) console.log(`Skipped ${dropped.length} non-${expected} member(s) on rebuild of "${title}": ${dropped.join(', ')}`)
  await addAllEmployeeColumns(sheets, title, kept, normalizedStore)

  await loadGrid(sheets, title, normalizedStore)
  console.log(`Recreated tab "${title}" with ${employees.filter((e) => String(e?.email || '').trim()).length} employee columns`)
  return { tab: title, employees: employees.filter((e) => String(e?.email || '').trim()).length }
}

/**
 * Adds a 2-column Presence/Location block for an employee on an existing tab
 * (used when a column was missed or the tab was created before the member existed).
 */
export async function addEmployeeColumnToTab(tab: string, employeeName: string, employeeEmail: string, store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim()
  if (!title) throw new Error('Tab name required')
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const email = String(employeeEmail || '').trim()
  if (!email) throw new Error('employeeEmail required')
  await assertStoreMember(email, normalizedStore)

  await ensureEmployeeColumn(sheets, title, String(employeeName || '').trim() || email.split('@')[0], email, normalizedStore)
  await loadGrid(sheets, title, normalizedStore)
  return true
}

/**
 * Strict isolation cleanup for one tab: deletes Presence/Location blocks whose member
 * has a *known* Members role from another group, then adds missing same-role
 * members. Unknown emails (not in Members) are left untouched.
 * Returns a report of what changed.
 */
export async function pruneForeignColumns(tab: string, store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const normalizedStore = normalizeStore(store ?? 'admin')
  const expected = roleForStore(normalizedStore)
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  if (!isAttendanceStructure(rows, headerRow)) {
    throw new Error(`Tab "${title}" is not an attendance sheet (no Presence/Location structure)`)
  }
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const headers = rows[namesRow] || []

  const directory = await getEmployees({ forceRefresh: true })
  const roleByEmail = new Map(
    directory.map((m: { email: string; role?: string }) => [
      String(m.email || '').trim().toLowerCase(),
      normalizeRole(m.role || ''),
    ]),
  )

  const foreign: { col: number; header: string; role: string }[] = []
  for (let c = 2; c < headers.length; c += COLS_PER_EMPLOYEE) {
    const header = String(headers[c] ?? '').trim()
    if (!header) continue
    const email = parseHeaderEmail(header)
    const role = email ? roleByEmail.get(email) : undefined
    if (role && role !== expected) foreign.push({ col: c, header, role })
  }

  const removed: string[] = []
  if (foreign.length) {
    const sheetId = await sheetIdFor(sheets, title, sid)
    if (sheetId == null) throw new Error(`Sheet tab "${title}" not found`)
    // Delete right-to-left so earlier column indexes stay valid.
    const requests = [...foreign]
      .sort((a, b) => b.col - a.col)
      .map((f) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: f.col, endIndex: f.col + COLS_PER_EMPLOYEE },
        },
      }))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sid, requestBody: { requests } })
    removed.push(...foreign.map((f) => `${f.header} (${f.role})`))
  }

  const sameRole = directory
    .filter((m: { email: string; role?: string }) =>
      normalizeRole(m.role || '') === expected && String(m.email || '').includes('@'),
    )
    .map((m: { name: string; email: string }) => ({ name: m.name, email: m.email }))
  const addedCount = await addAllEmployeeColumns(sheets, title, sameRole, normalizedStore)

  await loadGrid(sheets, title, normalizedStore)
  console.log(`Pruned "${title}" (${normalizedStore}): removed ${removed.length}, added ${addedCount}`)
  return { tab: title, store: normalizedStore, removed, addedCount }
}

const REAL_STATUSES = ['On-site', 'Remote']
function isRealStatus(status: string) {
  return REAL_STATUSES.includes(String(status || '').trim())
}

async function ensureTab(sheets: any, sid: string, store: StoreKind, title: string) {
  const tabs = await listTabs(sheets, sid)
  if (tabs.includes(title)) return title
  const parsed = parseMonthTitle(title)
  const { year, month } = parsed || nowParts()
  return createTab(sheets, title, year, month, store)
}

/**
 * Moves legacy mixed data to the right sheets: for every column in this store's
 * tab whose member has a *known* role from another group, copies day values into
 * the same tab of the correct store's spreadsheet (merge rule below), then deletes
 * the foreign columns here and adds missing same-role members.
 *
 * Merge rule per day (source = this tab, target = correct sheet):
 * - source empty -> skip
 * - target empty -> copy source
 * - source real (On-site/Remote), target auto (Absent/Holiday/empty) -> copy source
 * - target real, source not real -> keep target
 * - both real but different -> keep target + report conflict
 * - both non-real but different -> keep target (live sheet wins)
 */
export async function migrateForeignColumns(tab: string, store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const normalizedStore = normalizeStore(store ?? 'admin')
  const expected = roleForStore(normalizedStore)
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  if (!isAttendanceStructure(rows, headerRow)) {
    throw new Error(`Tab "${title}" is not an attendance sheet (no Presence/Location structure)`)
  }
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  const headers = rows[namesRow] || []

  const directory = await getEmployees({ forceRefresh: true })
  const roleByEmail = new Map(
    directory.map((m: { email: string; role?: string }) => [
      String(m.email || '').trim().toLowerCase(),
      normalizeRole(m.role || ''),
    ]),
  )

  const foreign: { col: number; header: string; email: string; role: MemberRole }[] = []
  for (let c = 2; c < headers.length; c += COLS_PER_EMPLOYEE) {
    const header = String(headers[c] ?? '').trim()
    if (!header) continue
    const email = parseHeaderEmail(header)
    const role = email ? roleByEmail.get(email) : undefined
    if (email && role && role !== expected) foreign.push({ col: c, header, email, role })
  }

  const moved: { email: string; days: number[]; to: StoreKind }[] = []
  const conflicts: { email: string; day: string; kept: string; skipped: string }[] = []

  // Group foreign columns by their correct target store.
  const byTarget = new Map<StoreKind, typeof foreign>()
  for (const f of foreign) {
    const target: StoreKind = f.role === 'Bootcamp' ? 'bootcamp' : f.role === 'Admin' ? 'admin' : 'employee'
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target)!.push(f)
  }

  for (const [targetStore, cols] of byTarget) {
    const targetSid = spreadsheetIdForStore(targetStore)
    const targetSheets = await sheetsClient(targetSid)
    const targetTitle = await ensureTab(targetSheets, targetSid, targetStore, title)
    const targetRes = await targetSheets.spreadsheets.values.get({
      spreadsheetId: targetSid,
      range: targetTitle,
      valueRenderOption: 'FORMATTED_VALUE',
    })
    const targetRows = targetRes.data.values || []
    const targetHeaderRow = findHeaderRow(targetRows)

    const data: { range: string; values: string[][] }[] = []
    for (const f of cols) {
      let targetCol = findEmployeeColumnByEmail(targetRows, targetHeaderRow, f.email)
      if (targetCol === -1) {
        await ensureEmployeeColumn(targetSheets, targetTitle, parseHeaderName(f.header) || f.email, f.email, targetStore)
        const reread = await targetSheets.spreadsheets.values.get({
          spreadsheetId: targetSid,
          range: targetTitle,
          valueRenderOption: 'FORMATTED_VALUE',
        })
        const rereadRows = reread.data.values || []
        targetCol = findEmployeeColumnByEmail(rereadRows, findHeaderRow(rereadRows), f.email)
        if (targetCol === -1) throw new Error(`Could not create column for "${f.email}" in ${targetStore} / ${targetTitle}`)
        // Refresh snapshot so later lookups see the new column.
        targetRows.length = 0
        targetRows.push(...rereadRows)
      }
      const movedDays: number[] = []
      for (let i = headerRow + 1; i < rows.length; i++) {
        const dayLabel = String(rows[i]?.[0] ?? '').trim()
        if (!dayLabel || dayLabel === ABSENT_SECTION || dayLabel.toLowerCase() === 'total') break
        if (!Number.isInteger(Number(dayLabel))) continue
        const sPresence = String(rows[i]?.[f.col] ?? '').trim()
        if (!sPresence) continue
        const sLoc = String(rows[i]?.[f.col + 1] ?? '').trim()
        let tRowIdx = -1
        try {
          tRowIdx = findDayRow(targetRows, targetHeaderRow, Number(dayLabel) || dayLabel)
        } catch {
          continue // day row missing in target — skip, report below
        }
        const tPresence = String(targetRows[tRowIdx]?.[targetCol] ?? '').trim()
        const tLoc = String(targetRows[tRowIdx]?.[targetCol + 1] ?? '').trim()
        if (sPresence === tPresence && sLoc === tLoc) continue
        const sReal = isRealStatus(splitPresence(sPresence).status)
        const tReal = isRealStatus(splitPresence(tPresence).status)
        const shouldCopy = !tPresence || (sReal && !tReal)
        if (shouldCopy) {
          data.push({
            range: `${targetTitle}!${columnLetter(targetCol)}${tRowIdx + 1}:${columnLetter(targetCol + 1)}${tRowIdx + 1}`,
            values: [[sPresence, sLoc]],
          })
          movedDays.push(Number(dayLabel))
          // Keep snapshot in sync for subsequent comparisons.
          targetRows[tRowIdx][targetCol] = sPresence
          targetRows[tRowIdx][targetCol + 1] = sLoc
        } else if (sReal && tReal) {
          conflicts.push({ email: f.email, day: dayLabel, kept: `${tPresence} ${tLoc}`.trim(), skipped: `${sPresence} ${sLoc}`.trim() })
        }
        // else: target (live sheet) wins silently for non-real differences
      }
      if (movedDays.length) moved.push({ email: f.email, days: movedDays, to: targetStore })
    }
    if (data.length) {
      await targetSheets.spreadsheets.values.batchUpdate({
        spreadsheetId: targetSid,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      })
    }
    await loadGrid(targetSheets, targetTitle, targetStore)
  }

  // Delete the foreign blocks here (right-to-left), then backfill same-role members.
  const removed: string[] = []
  if (foreign.length) {
    const sheetId = await sheetIdFor(sheets, title, sid)
    if (sheetId == null) throw new Error(`Sheet tab "${title}" not found`)
    const requests = [...foreign]
      .sort((a, b) => b.col - a.col)
      .map((f) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: f.col, endIndex: f.col + COLS_PER_EMPLOYEE },
        },
      }))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sid, requestBody: { requests } })
    removed.push(...foreign.map((f) => `${f.header} (${f.role})`))
  }

  const sameRole = directory
    .filter((m: { email: string; role?: string }) =>
      normalizeRole(m.role || '') === expected && String(m.email || '').includes('@'),
    )
    .map((m: { name: string; email: string }) => ({ name: m.name, email: m.email }))
  const addedCount = await addAllEmployeeColumns(sheets, title, sameRole, normalizedStore)

  await loadGrid(sheets, title, normalizedStore)
  console.log(`Migrated "${title}" (${normalizedStore}): moved ${moved.length} member(s), conflicts ${conflicts.length}, removed ${removed.length}, added ${addedCount}`)
  return { tab: title, store: normalizedStore, moved, conflicts, removed, addedCount }
}

/**
 * Re-runs auto-absent fill + Absent Days summary on a tab
 * (the same maintenance that runs on every grid load / hourly job).
 */
export async function refreshAttendanceTab(tab?: string, store?: unknown) {
  if (!hasGoogleCredentials() || !ADMIN_SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const normalizedStore = normalizeStore(store ?? 'admin')
  const sid = spreadsheetIdForStore(normalizedStore)
  const sheets = await sheetsClient(sid)
  const title = (tab || '').trim() || (await ensureMonthTab(sheets, normalizedStore))
  const tabs = await listTabs(sheets, sid)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const rows = await loadGrid(sheets, title, normalizedStore)
  let headerRow: number
  try {
    headerRow = findHeaderRow(rows)
  } catch {
    return { tab: title, days: 0, employees: 0 }
  }
  let lastDayRow = headerRow
  for (let i = headerRow + 1; i < rows.length; i++) {
    const d = Number(rows[i][0])
    if (!Number.isInteger(d)) break
    lastDayRow = i
  }
  const namesRow = findEmployeeNamesRow(rows, headerRow)
  let employees = 0
  for (let c = 2; c < (rows[namesRow]?.length ?? 0); c += COLS_PER_EMPLOYEE) {
    if (String(rows[namesRow][c] ?? '').trim()) employees++
  }
  return { tab: title, days: lastDayRow - headerRow, employees }
}
