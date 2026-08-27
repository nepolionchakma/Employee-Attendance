import fs from 'node:fs'

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID || ''
export const SHEET_TAB = process.env.ATTENDANCE_SHEET_TAB || ''

// GOOGLE_SERVICE_ACCOUNT_JSON accepts either:
//  - a file path (default ./service-account.json), or
//  - the service account JSON itself (stringified), for hosts without a
//    filesystem (e.g. Vercel).
const CREDENTIALS_ENV = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
const CREDENTIALS_JSON = CREDENTIALS_ENV.startsWith('{') ? CREDENTIALS_ENV : ''
const CREDENTIALS_PATH =
  CREDENTIALS_JSON ? '' : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json')

// Alternative: base64 of the service account JSON as an environment variable.
const CREDENTIALS_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''

const TZ = 'Asia/Dhaka'

const ABSENT_SECTION = 'Absent Days'

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
  return google.sheets({ version: 'v4', auth: client })
}

async function listTabs(sheets) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  })
  return res.data.sheets.map((s) => s.properties.title)
}

async function sheetIdFor(sheets, tab) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title,sheets.properties.sheetId',
  })
  return res.data.sheets.find((s) => s.properties.title === tab)?.properties.sheetId
}

/* ---- Employees / Members directory (dynamic, sheet-based) ---- */
const EMPLOYEES_SHEET = (process.env.EMPLOYEES_SHEET_TAB || 'Employees').trim() || 'Employees'
const EMPLOYEES_SHEET_CANDIDATES = [EMPLOYEES_SHEET].filter(Boolean)

let employeesCache = null
let employeesCacheAt = 0
const EMPLOYEES_CACHE_TTL = 60 * 1000 // 60s

function normalizeRole(v) {
  const r = String(v || '').trim().toLowerCase()
  return r === 'admin' ? 'admin' : 'employee'
}

async function resolveEmployeesSheetName(sheets) {
  return EMPLOYEES_SHEET
}

export async function ensureEmployeesSheet() {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return EMPLOYEES_SHEET
  const sheets = await sheetsClient()
  const tabs = await listTabs(sheets)
  const desired = EMPLOYEES_SHEET
  if (tabs.includes(desired)) {
    // if sheet exists but is empty (only header or no header), seed it
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${desired}!A1:D`,
        valueRenderOption: 'FORMATTED_VALUE',
      })
      const rows = res.data.values || []
      if (rows.length < 2) {
        const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees.js')
        const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
        const seed = (ALLOWED_EMAILS || []).map((email) => {
          const e = String(email).trim()
          const name = e.split('@')[0].replace(/[._]/g, ' ')
          const role = adminSet.has(e.toLowerCase()) ? 'admin' : 'employee'
          return [name, e, '', role]
        })
        if (seed.length) {
          // ensure header
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
    } catch {}
    return desired
  }
  // create
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
  // seed from fallback employees.js if sheet was empty
  try {
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees.js')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    const rows = (ALLOWED_EMAILS || []).map((email) => {
      const e = String(email).trim()
      const name = e.split('@')[0].replace(/[._]/g, ' ')
      const role = adminSet.has(e.toLowerCase()) ? 'admin' : 'employee'
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
  } catch {}
  employeesCache = null
  return desired
}

export async function getEmployees({ forceRefresh = false } = {}) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) {
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees.js')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    return (ALLOWED_EMAILS || []).map((email) => ({
      name: String(email).split('@')[0].replace(/[._]/g, ' '),
      email: String(email).trim(),
      phone: '',
      role: adminSet.has(String(email).trim().toLowerCase()) ? 'admin' : 'employee',
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
      range: `${tab}!A1:D`,
      valueRenderOption: 'FORMATTED_VALUE',
    })
    const rows = res.data.values || []
    if (rows.length < 2) {
      // empty sheet -> try fallback
      const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees.js')
      const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
      const fallback = (ALLOWED_EMAILS || []).map((email) => ({
        name: String(email).split('@')[0].replace(/[._]/g, ' '),
        email: String(email).trim(),
        phone: '',
        role: adminSet.has(String(email).trim().toLowerCase()) ? 'admin' : 'employee',
      }))
      employeesCache = fallback
      employeesCacheAt = now
      return fallback
    }
    // header is row 0, data from row 1
    const list = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || []
      const name = String(r[0] || '').trim()
      const email = String(r[1] || '').trim()
      const phone = String(r[2] || '').trim()
      const role = normalizeRole(r[3])
      if (!email || !email.includes('@')) continue
      list.push({ name: name || email.split('@')[0], email, phone, role })
    }
    employeesCache = list
    employeesCacheAt = now
    return list
  } catch (e) {
    console.warn('getEmployees failed, fallback to employees.js:', e.message)
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees.js')
    const adminSet = new Set((ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase()))
    return (ALLOWED_EMAILS || []).map((email) => ({
      name: String(email).split('@')[0].replace(/[._]/g, ' '),
      email: String(email).trim(),
      phone: '',
      role: adminSet.has(String(email).trim().toLowerCase()) ? 'admin' : 'employee',
    }))
  }
}

export function clearEmployeesCache() {
  employeesCache = null
  employeesCacheAt = 0
}

export async function addEmployee({ name, email, phone = '', role = 'employee' }) {
  if (!email || !email.includes('@')) throw new Error('Valid Gmail is required')
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[String(name || '').trim() || email.split('@')[0], String(email).trim(), String(phone).trim(), normalizeRole(role)]] },
  })
  clearEmployeesCache()
  return true
}

export async function updateEmployee(rowIndex, { name, email, phone, role }) {
  // rowIndex is 0-based data index (0 = first data row after header, i.e. sheet row 2)
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  const sheetRow = rowIndex + 2 // 1-based sheet row
  const values = [[String(name || '').trim(), String(email || '').trim(), String(phone || '').trim(), normalizeRole(role)]]
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${sheetRow}:D${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })
  clearEmployeesCache()
  return true
}

export async function deleteEmployee(rowIndex) {
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  const sheetId = await sheetIdFor(sheets, tab)
  if (sheetId == null) throw new Error('Employees sheet not found')
  const sheetRow = rowIndex + 2
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }],
    },
  })
  clearEmployeesCache()
  return true
}

/** Date parts in the office timezone (Asia/Dhaka). */
export function nowParts() {
  const fmt = (opts) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date())

  return {
    date: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    month: Number(fmt({ month: 'numeric' })),
    year: Number(fmt({ year: 'numeric' })),
    day: Number(fmt({ day: 'numeric' })),
    time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

/** Tab title for a month, e.g. "August 2026". */
function monthLabel(year, month) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function weekdayShort(year, month, day) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(year, month - 1, day, 12, 0, 0))
}

/** Column index (0-based) -> letter, e.g. 2 -> C. */
function columnLetter(index) {
  let letter = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

/** Builds the monthly grid inside a new tab (auto-created when missing). */
async function createTab(sheets, title, year, month) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  })

  const daysInMonth = new Date(year, month, 0).getDate()
  const titleRow = daysInMonth + 1 // 0-based index after headers + day rows
  const totalRow = titleRow + 1
  const values = [
    ['Date', 'Day'],
    ...Array.from({ length: daysInMonth }, (_, i) => [String(i + 1), weekdayShort(year, month, i + 1)]),
    [ABSENT_SECTION, ''],
    ['Total', ''],
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })

  await boldCells(sheets, title, [
    { row: titleRow, col: 0 },
    { row: totalRow, col: 0 },
  ])

  console.log(`Created attendance tab "${title}" (${daysInMonth} days)`)
  return title
}

/** Ensures a tab exists: pinned SHEET_TAB, or the current month's label. */
async function ensureMonthTab(sheets) {
  const tabs = await listTabs(sheets)
  const { year, month } = nowParts()
  const title = SHEET_TAB || monthLabel(year, month)
  if (tabs.includes(title)) return title
  return createTab(sheets, title, year, month)
}

function findHeaderRow(rows) {
  const idx = rows.findIndex((row) => String(row[0] || '').trim() === 'Date')
  if (idx === -1) throw new Error('No header row with "Date" found in the sheet')
  return idx
}

function findDayRow(rows, headerRow, day) {
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === String(day)) return i
  }
  throw new Error(`No row for day ${day} found in the sheet`)
}

/* ---- Employee header helpers (Gmail-based) ---- */
function parseHeaderEmail(header) {
  const h = String(header || '').trim()
  const m = h.match(/<([^>]+@[^>]+)>/)
  if (m) return m[1].trim().toLowerCase()
  if (h.includes('@') && !h.includes(' ') && h.includes('.')) return h.trim().toLowerCase()
  return null
}

function parseHeaderName(header) {
  const h = String(header || '').trim()
  const m = h.match(/^([^<]+)<[^>]+>$/)
  if (m) return m[1].trim()
  return h
}

function formatEmployeeHeader(name, email) {
  const n = String(name || '').trim()
  const e = String(email || '').trim().toLowerCase()
  if (!e) return n
  if (parseHeaderEmail(n)) return n
  return `${n} <${e}>`
}

function findEmployeeColumnByEmail(rows, headerRow, email) {
  const headers = rows[headerRow]
  const target = String(email || '').trim().toLowerCase()
  if (!target) return -1
  for (let i = 2; i < headers.length; i++) {
    const parsed = parseHeaderEmail(headers[i])
    if (parsed && parsed === target) return i
  }
  return -1
}

function findEmployeeColumnLegacyByName(rows, headerRow, name) {
  const headers = rows[headerRow]
  const target = String(name || '').trim().toLowerCase()
  if (!target) return -1
  for (let i = 2; i < headers.length; i++) {
    const h = String(headers[i] || '').trim()
    if (!h) continue
    if (parseHeaderEmail(h)) continue
    if (h.toLowerCase() === target) return i
  }
  return -1
}

function findEmployeeColumn(rows, headerRow, employeeName, employeeEmail) {
  if (employeeEmail) {
    const byEmail = findEmployeeColumnByEmail(rows, headerRow, employeeEmail)
    if (byEmail !== -1) return byEmail
  }
  if (employeeName) {
    const byName = findEmployeeColumnLegacyByName(rows, headerRow, employeeName)
    if (byName !== -1) return byName
    const headers = rows[headerRow]
    const idx = headers.findIndex(
      (h) => String(h || '').trim().toLowerCase() === String(employeeName).trim().toLowerCase(),
    )
    if (idx !== -1) return idx
  }
  const key = employeeEmail || employeeName
  throw new Error(
    `Employee "${key}" not found in the sheet headers. ` +
      'Add a column with that exact name, or fix the name in lib/employees.js.',
  )
}

/**
 * Adds a column for an employee (their Google full name + Gmail) if it's
 * missing. Gmail is stored in the header as "Name <email>" so results are
 * per-Gmail even when names collide (e.g. two "Nepolion Chakma").
 * For legacy sheets with bare name headers, the first login with that name
 * claims the column by renaming it to "Name <email>".
 */
async function ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail) {
  const email = String(employeeEmail || '').trim().toLowerCase()
  const name = String(employeeName || '').trim()
  if (!email && !name) throw new Error('employeeName or employeeEmail required')

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]

  if (email && findEmployeeColumnByEmail(rows, headerRow, email) !== -1) return

  if (email && name) {
    const legacyIdx = findEmployeeColumnLegacyByName(rows, headerRow, name)
    if (legacyIdx !== -1) {
      const newHeader = formatEmployeeHeader(headers[legacyIdx] || name, email)
      const range = `${tab}!${columnLetter(legacyIdx)}${headerRow + 1}`
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newHeader]] },
      })
      console.log(`Claimed legacy column "${headers[legacyIdx]}" for "${email}" -> "${newHeader}" in "${tab}"`)
      return
    }
  }

  if (name) {
    const existsName = headers.some((h) => String(h || '').trim().toLowerCase() === name.toLowerCase())
    if (existsName && !email) return
  }

  const newHeader = email ? formatEmployeeHeader(name || email, email) : name
  const range = `${tab}!${columnLetter(headers.length)}${headerRow + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[newHeader]] },
  })
  console.log(`Added employee column "${newHeader}" to "${tab}"`)
}

async function ensureEmployeeColumnByName(sheets, tab, employeeName) {
  return ensureEmployeeColumn(sheets, tab, employeeName, '')
}

/** Fills every empty cell for days before today with "Absent". */
async function markAbsentForPastDays(sheets, tab, rows) {
  const { day: today } = nowParts()
  const headerRow = findHeaderRow(rows)
  const firstEmployeeCol = 2
  const lastEmployeeCol = rows[headerRow].length
  let changed = false

  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day) || day >= today) break
    for (let c = firstEmployeeCol; c < lastEmployeeCol; c++) {
      if (String(rows[i][c] ?? '').trim() === '') {
        rows[i][c] = 'Absent'
        changed = true
      }
    }
  }

  if (!changed) return
  const lastCol = Math.max(...rows.map((r) => r.length))
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:${columnLetter(lastCol - 1)}${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  })
  console.log(`Marked "Absent" for past days in "${tab}"`)
}

/** Recomputes the "Absent Days" row (one count under each employee's column). */
async function updateAbsentSummary(sheets, tab, rows) {
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]
  const employeeCols = []
  for (let c = 2; c < headers.length; c++) {
    if (String(headers[c] ?? '').trim()) employeeCols.push(c)
  }
  const counts = new Map(employeeCols.map((col) => [col, 0]))

  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    for (let c = 2; c < rows[i].length; c++) {
      if (String(rows[i][c] ?? '').trim().toLowerCase() === 'absent' && counts.has(c)) {
        counts.set(c, counts.get(c) + 1)
      }
    }
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  let titleRow = -1
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] ?? '').trim() === ABSENT_SECTION) {
      titleRow = i
      break
    }
  }
  if (titleRow === -1) titleRow = rows.length

  const values = [
    [ABSENT_SECTION, '', ...employeeCols.map((col) => counts.get(col))],
    ['Total', total],
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${titleRow + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })

  await boldCells(sheets, tab, [
    { row: titleRow, col: 0 },
    { row: titleRow + 1, col: 0 },
  ])

  // Remove leftover rows from an older summary layout below the new one.
  if (titleRow !== -1 && rows.length > titleRow + 2) {
    const rest = rows.slice(titleRow + 2)
    const ours = rest.every((r) => {
      const a = String(r[0] ?? '').trim().toLowerCase()
      return a === ''
    })
    if (ours) {
      const sheetId = await sheetIdFor(sheets, tab)
      if (sheetId != null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: titleRow + 2,
                    endIndex: rows.length,
                  },
                },
              },
            ],
          },
        })
        console.log(`Removed leftover summary rows below "${ABSENT_SECTION}" in "${tab}"`)
      }
    }
  }
}

async function boldCells(sheets, tab, cells) {
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

/**
 * Reads the tab, fills past unmarked days with "Absent" and refreshes the
 * "Absent Days" summary. Returns the fresh rows.
 */
async function loadGrid(sheets, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  await markAbsentForPastDays(sheets, tab, rows)
  await updateAbsentSummary(sheets, tab, rows)
  return rows
}

/**
 * Returns { attended, status? } for an employee on a given day.
 * Gmail is primary key (header "Name <email>"); name is fallback for legacy sheets.
 */
export async function getAttendance(employeeName, employeeEmail, day) {
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
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  const status = String(rows[rowIdx][colIdx] ?? '').trim()
  return status ? { attended: true, status } : { attended: false }
}

/** Writes "Office" / "Home" into today's cell for the employee. */
export async function markAttendance(employeeName, employeeEmail, day, status) {
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
  const rows = await loadGrid(sheets, tab)

  const headerRow = findHeaderRow(rows)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}`
  const written = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  })
  return written.data.updatedCells > 0
}

export { parseHeaderEmail, parseHeaderName, formatEmployeeHeader }

/** Returns all sheet tab titles (months). */
export async function listMonthTabs() {
  const sheets = await sheetsClient()
  return listTabs(sheets)
}

/** Returns raw 2D values for any tab (generic sheet view). */
export async function getRawSheet(tab) {
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

/** Updates a single cell in a generic sheet by 0-based row/col. */
export async function updateRawCell(tab, row, col, value) {
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

/** Batch update generic cells in one request. */
export async function batchUpdateRawCells(tab, cells) {
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

/** Batch update attendance cells (Office/Home/Absent) in one request. Gmail is primary key. */
export async function batchUpdateAttendanceCells(tab, updates) {
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
    data.push({
      range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}`,
      values: [[normalized]],
    })
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
 * Returns the full grid for a tab (for admin). If `tab` is empty, uses the
 * current month's tab. Always backfills past days and recomputes the summary.
 * Shape: { tab, headers, employees, days: [{ date, day, values: { name: status }}], absentDays: { name: n }, total }
 */
export async function getAdminGrid(tab) {
  const sheets = await sheetsClient()
  let title = (tab || '').trim()
  if (!title) title = await ensureMonthTab(sheets)
  else {
    const tabs = await listTabs(sheets)
    if (!tabs.includes(title)) throw new Error(`Sheet tab "${title}" not found`)
  }
  const rows = await loadGrid(sheets, title)
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]
  const employees = []
  for (let c = 2; c < headers.length; c++) {
    const n = String(headers[c] ?? '').trim()
    if (n) employees.push(n)
  }
  const days = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const raw = String(rows[i][0] ?? '').trim()
    if (raw === ABSENT_SECTION || raw.toLowerCase() === 'total') break
    const d = Number(raw)
    if (!Number.isInteger(d)) continue
    const values = {}
    for (let c = 2; c < headers.length; c++) {
      const name = String(headers[c] ?? '').trim()
      if (!name) continue
      values[name] = String(rows[i][c] ?? '').trim()
    }
    days.push({ date: raw, day: String(rows[i][1] ?? '').trim(), values })
  }
  // Absent summary row
  let absentDays = {}
  let total = 0
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] ?? '').trim() === ABSENT_SECTION) {
      for (let c = 2; c < headers.length; c++) {
        const name = String(headers[c] ?? '').trim()
        if (!name) continue
        absentDays[name] = Number(rows[i][c] ?? 0) || 0
      }
      const next = rows[i + 1]
      if (next && String(next[0] ?? '').trim().toLowerCase() === 'total') {
        total = Number(next[1] ?? 0) || 0
      }
      break
    }
  }
  return { tab: title, headers, employees, days, absentDays, total }
}

/**
 * Admin: set a single cell to a status (Office/Home/Absent/empty). Gmail is primary key (pass employeeEmail for disambiguation).
 */
export async function adminUpdateCell(tab, employeeName, dayLabel, status, employeeEmail) {
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
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
  const rowIdx = findDayRow(rows, headerRow, Number(dayLabel) || dayLabel)

  const allowed = ['', 'Office', 'Home', 'Absent']
  const normalized = String(status ?? '').trim()
  if (!allowed.includes(normalized)) {
    throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
  }

  const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[normalized]] },
  })

  // Recompute summaries
  const rows2Res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: title,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows2 = rows2Res.data.values || []
  await updateAbsentSummary(sheets, title, rows2)
  return true
}

/** Backfills the current month's tab (used by the hourly auto-absent job). */
export async function backfillCurrentTab() {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await loadGrid(sheets, tab)
}

/**
 * Ensures the logged-in user has a column (their Google full name + Gmail) in the
 * current month's tab. Gmail disambiguates same names (e.g. two "Nepolion Chakma").
 */
export async function ensureEmployeeTabForUser(employeeName, employeeEmail) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail)
  await loadGrid(sheets, tab)
}