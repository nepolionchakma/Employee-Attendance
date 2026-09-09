
import fs from 'node:fs'

export const SPREADSHEET_ID: string = process.env.SPREADSHEET_ID || ''
export const SHEET_TAB = process.env.ATTENDANCE_SHEET_TAB || ''

const CREDENTIALS_ENV = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
const CREDENTIALS_JSON = CREDENTIALS_ENV.startsWith('{') ? CREDENTIALS_ENV : ''
const CREDENTIALS_PATH =
  CREDENTIALS_JSON ? '' : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json')

const CREDENTIALS_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''

const TZ = 'Asia/Dhaka'

const ABSENT_SECTION = 'Absent Days'
const COLS_PER_EMPLOYEE = 2

/**
 * Time string written into auto-absent cells for past days, e.g. "12:00 AM".
 * Customize with AUTO_ABSENT_TIME in .env (e.g. AUTO_ABSENT_TIME="2:00 AM" for testing).
 */
export const AUTO_ABSENT_TIME = (process.env.AUTO_ABSENT_TIME || '12:00 AM').trim() || '12:00 AM'

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

async function sheetsClient() {
  const { google } = await import('googleapis')
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not set. Add it to .env (see .env.example).')
  }
  const credentials = await loadCredentials()
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client } as any)
}

async function listTabs(sheets: any) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  })
  return res.data.sheets.map((s: any) => s.properties.title)
}

async function sheetIdFor(sheets: any, tab: string) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
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

function normalizeRole(v: string) {
  const r = String(v || '').trim().toLowerCase()
  return r === 'admin' ? 'Admin' : 'Employee'
}

async function resolveEmployeesSheetName(sheets: any) {
  return EMPLOYEES_SHEET
}

export async function ensureEmployeesSheet() {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return EMPLOYEES_SHEET
  const sheets = await sheetsClient()
  const tabs = await listTabs(sheets)
  const desired = EMPLOYEES_SHEET
  if (tabs.includes(desired)) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
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
              spreadsheetId: SPREADSHEET_ID,
              range: `${desired}!A1`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [['Full Name', 'Gmail', 'Phone', 'Role']] },
            })
          }
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${desired}!A2`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: seed },
          })
          employeesCache = null
        }
      }
    } catch (_e) {}
    return desired
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: desired } } }] },
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
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
        spreadsheetId: SPREADSHEET_ID,
        range: `${desired}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      })
    }
  } catch (_e) {}
  employeesCache = null
  return desired
}

export async function getEmployees({ forceRefresh = false } = {}) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) {
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
      spreadsheetId: SPREADSHEET_ID,
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:E`,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  return res.data.values || []
}

export async function addEmployee({ name, email, phone = '', role = 'Employee', address = '' }: { name?: string; email: string; phone?: string; role?: string; address?: string }) {
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
    spreadsheetId: SPREADSHEET_ID,
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
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${sheetRow}:E${sheetRow}`,
    // RAW for the same reason as addEmployee: preserve leading zeros in phones.
    valueInputOption: 'RAW',
    requestBody: { values },
  })
  clearEmployeesCache()
  return true
}

export async function deleteEmployee(rowIndex: number) {
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  const sheetId = await sheetIdFor(sheets, tab)
  if (sheetId == null) throw new Error('Employees sheet not found')
  // Same as updateEmployee: resolve the physical row from the non-empty data
  // rows so blank gap rows don't shift the delete onto the wrong member.
  const rows = await readEmployeesGrid(sheets, tab)
  const dataRows = memberDataRowIndexes(rows)
  const target = dataRows[rowIndex]
  if (target === undefined) throw new Error(`Member row ${rowIndex} not found in the ${tab} sheet`)
  const sheetRow = target + 1
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }],
    },
  })
  clearEmployeesCache()
  return true
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

/** Old merged format: Presence holds 'Status - Time', second column is Location. */
function isMergedPresenceFormat(rows: any[], headerRow: number) {
  const row = rows[headerRow] || []
  for (let i = 3; i < Math.min(10, row.length); i++) {
    if (String(row[i] || '').trim().toLowerCase() === 'location') return true
  }
  return false
}

/** Legacy detection: true 3-col blocks (Presence/Time/Location).
 * Must require BOTH markers — the new Presence+Time format also has a 'Time'
 * header, and matching that made the auto-absent fill stride 3 columns and
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
}/* ---- migrate: old 'Status - Time' + Location format → Presence + Time ---- */

/**
 * Rewrites a tab from the old merged format (Presence = 'Status - Time',
 * Location column) into the new format (Presence = pure status, Time column).
 * No-op if the tab already uses the new format.
 */
async function migrateMergedToPresenceTime(sheets: any, tab: string) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  if (!isMergedPresenceFormat(rows, headerRow)) return false

  const namesRow = findEmployeeNamesRow(rows, headerRow)
  for (let i = 3; i < (rows[headerRow]?.length ?? 0); i++) {
    if (String(rows[headerRow][i] || '').trim().toLowerCase() === 'location') {
      rows[headerRow][i] = 'Time'
    }
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    for (let c = 2; c < row.length; c += 2) {
      const presence = String(row[c] ?? '').trim()
      if (!presence) continue
      const dashIdx = presence.lastIndexOf(' - ')
      if (dashIdx === -1) continue
      const status = presence.substring(0, dashIdx).trim()
      const time = presence.substring(dashIdx + 3).trim()
      row[c] = status
      // Always write the parsed time — the old location value (e.g. 'N/A' or a
      // place name) is dropped because location no longer exists in this format.
      row[c + 1] = time
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  })
  console.log(`Migrated tab "${tab}" from merged 'Status - Time'+Location to Presence+Time`)
  return true
}

/* ---- createTab with Timestamp row + Date/Day/Presence/Time headers ---- */

async function createTab(sheets: any, title: string, year: number, month: number) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
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
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })

  await boldCells(sheets, title, [
    { row: 0, col: 0 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: totalRow - 1, col: 0 },
  ])

  await applyEmployeeFormatting(sheets, title)

  // Pre-populate one Presence/Time column block for EVERY member so a new
  // month tab is immediately usable by the whole team (no first-login wait),
  // then auto-fill past days (Absent with AUTO_ABSENT_TIME, Fridays Holiday)
  // and write the Absent Days COUNTIF summary for everyone.
  try {
    const members = await getEmployees({ forceRefresh: true })
    const added = await addAllEmployeeColumns(sheets, title, members)
    if (added > 0 || members.length) {
      const filled = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: title,
        valueRenderOption: 'FORMATTED_VALUE',
      })
      const rows = filled.data.values || []
      await markAbsentForPastDays(sheets, title, rows)
      await updateAbsentSummary(sheets, title, rows)
    }
  } catch (e) {
    console.warn(`Member pre-population skipped for "${title}":`, (e as Error).message)
  }

  console.log(`Created attendance tab "${title}" (${daysInMonth} days, 2-col with Timestamp row)`)
  return title
}

/**
 * Adds Presence/Time blocks for ALL given members in ONE batched pass
 * (1 read + 1 column expansion + 1 batch write + 1 formatting pass),
 * unlike per-member ensureEmployeeColumn calls which hit the Sheets read quota.
 * Returns how many columns were added.
 */
async function addAllEmployeeColumns(sheets: any, tab: string, members: { name?: string; email?: string }[]) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
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
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const sheetProps = sheetMeta.data.sheets?.find((s: any) => s.properties?.title === tab)
  const currentCols = sheetProps?.properties?.gridProperties?.columnCount || 26
  if (neededCols > currentCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
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
    data.push({ range: `${tab}!${columnLetter(startCol)}${headerRow + 1}:${columnLetter(startCol + 1)}${headerRow + 1}`, values: [['Presence', 'Time']] })
    startCol += COLS_PER_EMPLOYEE
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })

  await applyEmployeeFormatting(sheets, tab)
  console.log(`Added ${missing.length} employee column block(s) to "${tab}" in one batch`)
  return missing.length
}

async function ensureMonthTab(sheets: any) {
  const tabs = await listTabs(sheets)
  const { year, month } = nowParts()
  const title = SHEET_TAB || monthLabel(year, month)
  if (tabs.includes(title)) return title
  return createTab(sheets, title, year, month)
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
 * (Presence/Time) with sub-header row.
 */
async function ensureEmployeeColumn(sheets: any, tab: string, employeeName: string, employeeEmail?: string) {
  const email = String(employeeEmail || '').trim().toLowerCase()
  const name = String(employeeName || '').trim()
  if (!email && !name) throw new Error('employeeName or employeeEmail required')

  let res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
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
          spreadsheetId: SPREADSHEET_ID,
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
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    const sheetProps = sheetMeta.data.sheets?.find((s: any) => s.properties?.title === tab)
    const currentCols = sheetProps?.properties?.gridProperties?.columnCount || 26
    if (neededCols > currentCols) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ updateSheetProperties: { properties: { sheetId: sheetProps?.properties?.sheetId, gridProperties: { columnCount: neededCols } }, fields: 'gridProperties.columnCount' } }],
        },
      })
      console.log(`Expanded "${tab}" from ${currentCols} to ${neededCols} columns`)
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!${columnLetter(startCol)}${namesRow + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader]] },
    })
    const headerCells = rows[headerRow] || []
    if (String(headerCells[startCol] || '').trim().toLowerCase() !== 'presence') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!${columnLetter(startCol)}${headerRow + 1}:${columnLetter(startCol + 1)}${headerRow + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Presence', 'Time']] },
      })
    }
    await applyEmployeeFormatting(sheets, tab)
    console.log(`Added employee 2-col "${newHeader}" to "${tab}" at col ${startCol}`)
  } else {
    const range = `${tab}!${columnLetter(rows[namesRow].length)}${namesRow + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader]] },
    })
    console.log(`Added employee column "${newHeader}" to "${tab}"`)
  }
}

/** Fills empty cells for past days with "Absent - 12:00 AM" (for 2-col) or "Holiday" for Fridays. */
async function markAbsentForPastDays(sheets: any, tab: string, rows: any[]) {
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

  // Advance one full employee block per iteration (2 cols for Presence+Time,
  // 3 for legacy) so a filled pair is never re-read as an empty Presence cell —
  // stepping by 1 used to misalign Fridays after the first pass.
  const fillStep = isLegacy3 ? 3 : isAtt ? COLS_PER_EMPLOYEE : 1
  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    if (day >= today) continue
    const dayName = String(rows[i][1] || '').trim()
    const isFriday = dayName === 'Fri'
    for (let c = firstEmployeeCol; c < lastEmployeeCol; c += fillStep) {
      if (String(rows[i][c] ?? '').trim() === '') {
        if (isLegacy3) {
          // Legacy 3-col: merge time into presence
          if (isFriday) {
            rows[i][c] = 'Holiday'
            rows[i][c + 1] = ''
            rows[i][c + 2] = ''
          } else {
            rows[i][c] = 'Absent'
            rows[i][c + 1] = AUTO_ABSENT_TIME
            rows[i][c + 2] = ''
          }
        } else if (isAtt) {
          // New 2-col: presence + time
          if (isFriday) {
            rows[i][c] = 'Holiday'
            rows[i][c + 1] = ''
          } else {
            rows[i][c] = 'Absent'
            rows[i][c + 1] = AUTO_ABSENT_TIME
          }
        } else {
          rows[i][c] = isFriday ? 'Holiday' : 'Absent'
        }
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
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A${headerRow + 2}:${columnLetter(lastEmployeeCol - 1)}${headerRow + 1 + dataRows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows },
    })
  }
  console.log(`Marked "Absent" for past days in "${tab}"`)
}

async function updateAbsentSummary(sheets: any, tab: string, rows: any[]) {
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
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${titleRow + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [absentRow] },
  })

  await boldCells(sheets, tab, [
    { row: titleRow, col: 0 },
  ])
}

async function boldCells(sheets: any, tab: string, cells: { row: number; col: number }[]) {
  const sheetId = await sheetIdFor(sheets, tab)
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
    spreadsheetId: SPREADSHEET_ID,
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
const FRIDAY_COLOR = { red: 1.0, green: 0.92, blue: 0.8 }
const SOLID_MEDIUM = { style: 'SOLID_MEDIUM' }

async function applyEmployeeFormatting(sheets: any, tab: string) {
  const sheetId = await sheetIdFor(sheets, tab)
  if (sheetId == null) return

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
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

  // Bold all employee sub-header cells in row 1 (Date/Day/Presence/Time)
  const boldRow1: { row: number; col: number }[] = [{ row: 1, col: 0 }, { row: 1, col: 1 }]
  for (let i = 0; i < numEmps; i++) {
    const sc = 2 + i * COLS_PER_EMPLOYEE
    for (let c = sc; c < sc + COLS_PER_EMPLOYEE; c++) {
      boldRow1.push({ row: 1, col: c })
    }
  }
  await boldCells(sheets, tab, boldRow1)

  for (let r = headerRow + 1; r <= lastDayRow; r++) {
    const dayName = String(rows[r][1] || '').trim()
    if (dayName === 'Fri') {
      const totalCols = 2 + numEmps * COLS_PER_EMPLOYEE
      requests.push(bgCells(r, 0, totalCols, FRIDAY_COLOR))
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
  const totalCols = 2 + numEmps * COLS_PER_EMPLOYEE
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: lastDayRow + 2, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
      fields: 'userEnteredFormat.wrapStrategy',
    },
  })

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    })
  }
  console.log(`Applied formatting to "${tab}" (${numEmps} employees)`)
}

let migratedTabs = new Set<string>()

async function loadGrid(sheets: any, tab: string) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  // One-time auto-migration: merged 'Status - Time' + Location → Presence + Time.
  // Guarded per process+tab so page loads don't re-check every time.
  if (!migratedTabs.has(tab)) {
    migratedTabs.add(tab)
    if (isMergedPresenceFormat(rows, findHeaderRow(rows))) {
      try {
        await migrateMergedToPresenceTime(sheets, tab)
        return await loadGrid(sheets, tab) // re-read the migrated grid
      } catch (e) {
        console.warn(`Migration skipped for "${tab}":`, (e as Error).message)
      }
    }
  }
  await markAbsentForPastDays(sheets, tab, rows)
  await updateAbsentSummary(sheets, tab, rows)
  return rows
}

/**
 * Returns { attended, status, time? } for an employee on a given day.
 */
export async function getAttendance(employeeName: string, employeeEmail?: string, day?: number | string) {
  if (day === undefined) {
    const maybeDay = employeeEmail
    const isDay = typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    if (isDay) {
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail)
  const rows = await loadGrid(sheets, tab)
  const headerRow = findHeaderRow(rows)
  const isAtt = isAttendanceStructure(rows, headerRow)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  if (isAtt) {
    const status = String(rows[rowIdx][colIdx] ?? '').trim()
    if (!status) return { attended: false }
    // New format: pure status in col, time in col+1.
    // Old merged format ('Office - 12:00 AM') still reads correctly pre-migration.
    const dashIdx = status.lastIndexOf(' - ')
    if (dashIdx !== -1) {
      return { attended: true, status: status.substring(0, dashIdx).trim(), time: status.substring(dashIdx + 3).trim() }
    }
    const time = String(rows[rowIdx][colIdx + 1] ?? '').trim()
    return { attended: true, status, time }
  }
  const status = String(rows[rowIdx][colIdx] ?? '').trim()
  return status ? { attended: true, status } : { attended: false }
}

/**
 * Writes attendance for the employee on a day.
 * Presence column = pure status, Time column = the time.
 */
export async function markAttendance(employeeName: string, employeeEmail?: string, day?: number | string, status?: string, time?: string) {
  if (status === undefined) {
    const maybeDay = employeeEmail
    const maybeStatus = day
    const isDay = typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    const isStatus = typeof maybeStatus === 'string' && ['', 'Office', 'Home', 'Absent'].includes(String(maybeStatus).trim())
    if (isDay && isStatus) {
      status = maybeStatus
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail)

  let rows = await loadGrid(sheets, tab)
  let headerRow = findHeaderRow(rows)
  // The merged format ('Presence' = 'Status - Time' + a Location column) also
  // satisfies isAttendanceStructure, so migrate whenever its Location header
  // is detected — not just when the Presence header is missing.
  if (isMergedPresenceFormat(rows, headerRow)) {
    const migrated = await migrateMergedToPresenceTime(sheets, tab)
    if (migrated) {
      rows = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: tab, valueRenderOption: 'FORMATTED_VALUE' }).then(r => r.data.values || [])
      headerRow = findHeaderRow(rows)
    }
  }
  const isNew = isAttendanceStructure(rows, headerRow)

  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  const t = String(time || '').trim() || new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())

  if (isNew) {
    const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`
    const written = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status, t]] },
    })
    return (written.data.updatedCells ?? 0) > 0
  }

  const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}`
  const written = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  })
  return (written.data.updatedCells ?? 0) > 0
}

export { parseHeaderEmail, parseHeaderName, formatEmployeeHeader }

export async function listMonthTabs() {
  const sheets = await sheetsClient()
  return listTabs(sheets)
}

export async function getRawSheet(tab: string) {
  const sheets = await sheetsClient()
  let title = (tab || '').trim()
  if (!title) title = await ensureMonthTab(sheets)
  else {
    const tabs = await listTabs(sheets)
    if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  return { tab: title, values: res.data.values || [] }
}

export async function updateRawCell(tab: string, row: number, col: number, value: string) {
  const sheets = await sheetsClient()
  const title = (tab || '').trim() || (await ensureMonthTab(sheets))
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const range = `${title}!${columnLetter(col)}${row + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[String(value ?? '')]] },
  })
  return true
}

export async function batchUpdateRawCells(tab: string, cells: { row: number; col: number; value: string }[]) {
  if (!cells?.length) return true
  const sheets = await sheetsClient()
  const title = (tab || '').trim() || (await ensureMonthTab(sheets))
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const data = cells.map(({ row, col, value }) => ({
    range: `${title}!${columnLetter(col)}${row + 1}`,
    values: [[String(value ?? '')]],
  }))
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
  return true
}

export async function batchUpdateAttendanceCells(tab: string, updates: { employeeName?: string; employeeEmail?: string; name?: string; email?: string; day: string; status: string; time?: string }[]) {
  if (!updates?.length) return true
  const sheets = await sheetsClient()
  const title = (tab || '').trim() || (await ensureMonthTab(sheets))
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const is3col = isAttendanceStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const allowed = ['', 'Office', 'Home', 'Absent']

  const data = []
  for (const u of updates) {
    const employeeName = String(u.employeeName || u.name || '').trim()
    const employeeEmail = String(u.employeeEmail || u.email || '').trim().toLowerCase()
    const day = String(u.day || '').trim()
    const normalized = String(u.status ?? '').trim()
    if (!allowed.includes(normalized)) {
      throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
    }
    const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
    const rowIdx = findDayRow(rows, headerRow, Number(day) || day)
    if (is3col) {
      // Presence col + Time col. Auto-time when status changes and no time given.
      let timeStr = String(u.time || '').trim()
      if (!timeStr) {
        const existingStatus = String(rows[rowIdx]?.[colIdx] ?? '').trim()
        const existingTime = String(rows[rowIdx]?.[colIdx + 1] ?? '').trim()
        if (normalized && normalized !== existingStatus) {
          timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
        } else if (existingTime) {
          timeStr = existingTime
        }
      }
      data.push({
        range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`,
        values: [[normalized, timeStr]],
      })
    } else {
      data.push({
        range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}`,
        values: [[normalized]],
      })
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })

  const rows2Res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows2 = rows2Res.data.values || []
  await updateAbsentSummary(sheets, title, rows2)
  return true
}

/**
 * Returns the full grid for a tab (for admin).
 * For 2-col: reads Presence + Time per employee.
 */
export async function getAdminGrid(tab: string) {
  const sheets = await sheetsClient()
  let title = (tab || '').trim()
  if (!title) title = await ensureMonthTab(sheets)
  else {
    const tabs = await listTabs(sheets)
    if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  }
  const rows = await loadGrid(sheets, title)
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
    for (const emp of employees) {
      const c = findEmployeeColumn(rows, headerRow, emp)
      if (isLegacy) {
        // Legacy 3-col: separate status, time, location
        values[emp] = String(rows[i][c] ?? '').trim()
        timeValues[emp] = String(rows[i][c + 1] ?? '').trim()
      } else if (is3col) {
        // Current 2-col: pure status in col, time in col+1.
        // Old merged 'Status - Time' still parses pre-migration.
        const v = String(rows[i][c] ?? '').trim()
        const dashIdx = v.lastIndexOf(' - ')
        if (dashIdx !== -1) {
          values[emp] = v.substring(0, dashIdx).trim()
          timeValues[emp] = v.substring(dashIdx + 3).trim()
        } else {
          values[emp] = v
          timeValues[emp] = String(rows[i][c + 1] ?? '').trim()
        }
      } else {
        values[emp] = String(rows[i][c] ?? '').trim()
      }
    }
    days.push({ date: raw, day: String(rows[i][1] ?? '').trim(), values, timeValues })
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

export async function adminUpdateCell(tab: string, employeeName: string, dayLabel: string, status: string, employeeEmail?: string) {
  const sheets = await sheetsClient()
  const title = (tab || '').trim() || (await ensureMonthTab(sheets))
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const is3col = isAttendanceStructure(rows, headerRow)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
  const rowIdx = findDayRow(rows, headerRow, Number(dayLabel) || dayLabel)

  const allowed = ['', 'Office', 'Home', 'Absent']
  const normalized = String(status ?? '').trim()
  if (!allowed.includes(normalized)) {
    throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
  }

  if (is3col) {
    const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
    const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 1)}${rowIdx + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[normalized, t]] },
    })
  } else {
    const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[normalized]] },
    })
  }

  const rows2Res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows2 = rows2Res.data.values || []
  await updateAbsentSummary(sheets, title, rows2)
  return true
}

export async function backfillCurrentTab() {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await loadGrid(sheets, tab)
}

export async function ensureEmployeeTabForUser(employeeName: string, employeeEmail: string) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail)
  await loadGrid(sheets, tab)
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
 * (Timestamp row / names row / Date+Day+Presence+Time headers / Absent Days row),
 * then adds a 2-column block for every given employee and auto-fills
 * past days (Absent with AUTO_ABSENT_TIME, Fridays as Holiday).
 * Used to repair tabs that drifted into a legacy/mixed structure.
 */
export async function recreateAttendanceTab(tab: string, employees: { name: string; email: string }[]) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const sheets = await sheetsClient()
  const title = (tab || '').trim()
  if (!title) throw new Error('Tab name required')

  const tabs = await listTabs(sheets)
  if (tabs.includes(title)) {
    const sheetId = await sheetIdFor(sheets, title)
    if (sheetId == null) throw new Error(`Sheet tab "${title}" not found`)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteSheet: { sheetId } }] },
    })
  }

  const parsed = parseMonthTitle(title)
  const { year, month } = parsed || nowParts()
  await createTab(sheets, title, year, month)

  await addAllEmployeeColumns(sheets, title, employees)

  await loadGrid(sheets, title)
  console.log(`Recreated tab "${title}" with ${employees.filter((e) => String(e?.email || '').trim()).length} employee columns`)
  return { tab: title, employees: employees.filter((e) => String(e?.email || '').trim()).length }
}

/**
 * Adds a 2-column Presence/Time block for an employee on an existing tab
 * (used when a column was missed or the tab was created before the member existed).
 */
export async function addEmployeeColumnToTab(tab: string, employeeName: string, employeeEmail: string) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const sheets = await sheetsClient()
  const title = (tab || '').trim()
  if (!title) throw new Error('Tab name required')
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  const email = String(employeeEmail || '').trim()
  if (!email) throw new Error('employeeEmail required')

  await ensureEmployeeColumn(sheets, title, String(employeeName || '').trim() || email.split('@')[0], email)
  await loadGrid(sheets, title)
  return true
}

/**
 * Re-runs auto-absent fill + Absent Days summary on a tab
 * (the same maintenance that runs on every grid load / hourly job).
 */
export async function refreshAttendanceTab(tab?: string) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) throw new Error('Google Sheets not configured')
  const sheets = await sheetsClient()
  const title = (tab || '').trim() || (await ensureMonthTab(sheets))
  const tabs = await listTabs(sheets)
  if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)

  const rows = await loadGrid(sheets, title)
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
