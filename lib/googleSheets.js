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

  console.log(
    `Created attendance tab "${title}" (${daysInMonth} days, ${EMPLOYEES.length} employees)`,
  )
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

function findEmployeeColumn(rows, headerRow, employeeName) {
  const headers = rows[headerRow]
  const idx = headers.findIndex(
    (h) => String(h || '').trim().toLowerCase() === employeeName.trim().toLowerCase(),
  )
  if (idx === -1) {
    throw new Error(
      `Employee "${employeeName}" not found in the sheet headers. ` +
      'Add a column with that exact name, or fix the name in lib/employees.js.',
    )
  }
  return idx
}

/**
 * Adds a column for an employee (their Google full name) if it's missing from
 * the header row. Employee columns are created per logged-in user.
 */
async function ensureEmployeeColumn(sheets, tab, employeeName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]

  const exists = headers.some(
    (h) => String(h || '').trim().toLowerCase() === employeeName.trim().toLowerCase(),
  )
  if (exists) return

  const range = `${tab}!${columnLetter(headers.length)}${headerRow + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[employeeName]] },
  })
  console.log(`Added employee column "${employeeName}" to "${tab}"`)
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
 * Returns { attended, status? } for an employee on a given day of the month.
 * "attended" is true when the employee's cell for that day already has a value
 * (Office, Home, Absent, ...).
 */
export async function getAttendance(employeeName, day) {
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName)
  const rows = await loadGrid(sheets, tab)

  const headerRow = findHeaderRow(rows)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName)

  const status = String(rows[rowIdx][colIdx] ?? '').trim()
  return status ? { attended: true, status } : { attended: false }
}

/** Writes "Office" / "Home" into today's cell for the employee. */
export async function markAttendance(employeeName, day, status) {
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName)
  const rows = await loadGrid(sheets, tab)

  const headerRow = findHeaderRow(rows)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName)

  const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}`
  const written = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  })
  return written.data.updatedCells > 0
}

/** Backfills the current month's tab (used by the hourly auto-absent job). */
export async function backfillCurrentTab() {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await loadGrid(sheets, tab)
}

/**
 * Ensures the logged-in user has a column (their Google full name) in the
 * current month's tab. Called right after a successful Google login.
 */
export async function ensureEmployeeTabForUser(employeeName) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName)
  await loadGrid(sheets, tab)
}