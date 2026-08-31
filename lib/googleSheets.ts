// @ts-nocheck
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
const COLS_PER_EMPLOYEE = 3

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

/* ---- Employees / Members directory ---- */
const EMPLOYEES_SHEET = (process.env.EMPLOYEES_SHEET_TAB || 'Employees').trim() || 'Employees'
const EMPLOYEES_SHEET_CANDIDATES = [EMPLOYEES_SHEET].filter(Boolean)

let employeesCache = null
let employeesCacheAt = 0
const EMPLOYEES_CACHE_TTL = 60 * 1000

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
          const role = adminSet.has(e.toLowerCase()) ? 'admin' : 'employee'
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
      const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
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
    console.warn('getEmployees failed, fallback to employees:', (e as Error).message)
    const { ALLOWED_EMAILS, ADMIN_EMAILS } = await import('./employees')
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
  const sheets = await sheetsClient()
  const tab = await ensureEmployeesSheet()
  const sheetRow = rowIndex + 2
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

/* ---- 3-column structure detection ---- */

function isNewThreeColStructure(rows, headerRow) {
  if (headerRow + 1 >= rows.length) return false
  const subRow = rows[headerRow + 1] || []
  for (let i = 2; i < Math.min(5, subRow.length); i++) {
    if (String(subRow[i] || '').trim().toLowerCase() === 'presence') return true
  }
  return false
}

/* ---- migrateToThreeCol ---- */

async function migrateToThreeCol(sheets, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = res.data.values || []
  const headerRow = findHeaderRow(rows)
  if (isNewThreeColStructure(rows, headerRow)) return false

  const headers = rows[headerRow]
  const newHeaders0 = [...headers.slice(0, 2)]
  const newHeaders1 = ['', '']
  for (let i = 2; i < headers.length; i++) {
    const h = String(headers[i] || '').trim()
    if (!h) continue
    newHeaders0.push(h, '', '')
    newHeaders1.push('Presence', 'Time', 'Location')
  }

  const newRows = []
  newRows.push(newHeaders0)
  newRows.push(newHeaders1)
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    if (String(row[0] || '').trim() === ABSENT_SECTION || String(row[0] || '').trim().toLowerCase() === 'total') {
      const newRow = [row[0] || '', row[1] || '']
      for (let i = 2; i < headers.length; i++) {
        newRow.push(String(row[i] || '').trim(), '', '')
      }
      newRows.push(newRow)
      continue
    }
    const day = String(row[0] || '').trim()
    if (!day) {
      newRows.push(row)
      continue
    }
    const newRow = [row[0] || '', row[1] || '']
    for (let i = 2; i < headers.length; i++) {
      const v = String(row[i] || '').trim()
      if (v.toLowerCase() === 'absent') {
        newRow.push('Absent', '12:00 AM', 'Unknown')
      } else if (v) {
        newRow.push(v, '', '')
      } else {
        newRow.push('', '', '')
      }
    }
    newRows.push(newRow)
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newRows },
  })
  console.log(`Migrated tab "${tab}" from 1-col to 3-col`)
  return true
}

/* ---- createTab with 2-row headers (3-col per employee) ---- */

async function createTab(sheets, title, year, month) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  })

  const daysInMonth = new Date(year, month, 0).getDate()
  const titleRow = daysInMonth + 2
  const totalRow = titleRow + 1

  const row0 = ['Date', 'Day']
  const row1 = ['', '']
  const values = [
    row0,
    row1,
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
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: titleRow, col: 0 },
    { row: totalRow, col: 0 },
  ])

  console.log(`Created attendance tab "${title}" (${daysInMonth} days, 3-col structure)`)
  return title
}

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
  const step = isNewThreeColStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
  for (let i = 2; i < headers.length; i += step) {
    const parsed = parseHeaderEmail(headers[i])
    if (parsed && parsed === target) return i
  }
  return -1
}

function findEmployeeColumnLegacyByName(rows, headerRow, name) {
  const headers = rows[headerRow]
  const target = String(name || '').trim().toLowerCase()
  if (!target) return -1
  const step = isNewThreeColStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
  for (let i = 2; i < headers.length; i += step) {
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
    const step = isNewThreeColStructure(rows, headerRow) ? COLS_PER_EMPLOYEE : 1
    const idx = headers.findIndex(
      (h) => String(h || '').trim().toLowerCase() === String(employeeName).trim().toLowerCase(),
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
 * Ensures employee column exists. For 3-col structure, adds 3 columns at once
 * (Presence/Time/Location) with sub-header row.
 */
async function ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail) {
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

  if (email && findEmployeeColumnByEmail(rows, headerRow, email) !== -1) return

  if (email && name) {
    const legacyIdx = findEmployeeColumnLegacyByName(rows, headerRow, name)
    if (legacyIdx !== -1) {
      const newHeader = formatEmployeeHeader(rows[headerRow][legacyIdx] || name, email)
      const range = `${tab}!${columnLetter(legacyIdx)}${headerRow + 1}`
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

  if (name) {
    const existsName = rows[headerRow].some((h) => String(h || '').trim().toLowerCase() === name.toLowerCase())
    if (existsName && !email) return
  }

  const isNew = isNewThreeColStructure(rows, headerRow)
  const newHeader = email ? formatEmployeeHeader(name || email, email) : name

  if (isNew) {
    const startCol = rows[headerRow].length
    const headerRange = `${tab}!${columnLetter(startCol)}${headerRow + 1}:${columnLetter(startCol + 2)}${headerRow + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: headerRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader, '', '']] },
    })
    const subHeaderRow = headerRow + 1
    const subHeaders = rows[subHeaderRow] || []
    if (String(subHeaders[startCol] || '').trim().toLowerCase() !== 'presence') {
      const subRange = `${tab}!${columnLetter(startCol)}${subHeaderRow + 1}:${columnLetter(startCol + 2)}${subHeaderRow + 1}`
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: subRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Presence', 'Time', 'Location']] },
      })
    }
    console.log(`Added employee 3-col "${newHeader}" to "${tab}" at col ${startCol}`)
  } else {
    const range = `${tab}!${columnLetter(rows[headerRow].length)}${headerRow + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHeader]] },
    })
    console.log(`Added employee column "${newHeader}" to "${tab}"`)
  }
}

/** Fills empty cells for past days with "Absent" (and "12:00 AM | Unknown" for 3-col). */
async function markAbsentForPastDays(sheets, tab, rows) {
  const { day: today } = nowParts()
  const headerRow = findHeaderRow(rows)
  const firstEmployeeCol = 2
  const lastEmployeeCol = rows[headerRow].length
  let changed = false
  const is3col = isNewThreeColStructure(rows, headerRow)

  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day) || day >= today) break
    for (let c = firstEmployeeCol; c < lastEmployeeCol; c++) {
      if (String(rows[i][c] ?? '').trim() === '') {
        if (is3col) {
          rows[i][c] = 'Absent'
          rows[i][c + 1] = '12:00 AM'
          rows[i][c + 2] = 'Unknown'
          c += 2
        } else {
          rows[i][c] = 'Absent'
        }
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

async function updateAbsentSummary(sheets, tab, rows) {
  const headerRow = findHeaderRow(rows)
  const headers = rows[headerRow]
  const is3col = isNewThreeColStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const employeeCols = []
  for (let c = 2; c < headers.length; c += step) {
    if (String(headers[c] ?? '').trim()) employeeCols.push(c)
  }
  const counts = new Map(employeeCols.map((col) => [col, 0]))

  for (let i = headerRow + 1; i < rows.length; i++) {
    const day = Number(rows[i][0])
    if (!Number.isInteger(day)) break
    for (const c of employeeCols) {
      const v = String(rows[i][c] ?? '').trim().toLowerCase()
      if (v === 'absent') {
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
 * Returns { attended, status, time?, location? } for an employee on a given day.
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
  const is3col = isNewThreeColStructure(rows, headerRow)
  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  if (is3col) {
    const status = String(rows[rowIdx][colIdx] ?? '').trim()
    const time = String(rows[rowIdx][colIdx + 1] ?? '').trim()
    const location = String(rows[rowIdx][colIdx + 2] ?? '').trim()
    return status ? { attended: true, status, time, location } : { attended: false }
  }
  const status = String(rows[rowIdx][colIdx] ?? '').trim()
  return status ? { attended: true, status } : { attended: false }
}

/**
 * Writes attendance to today's cell for the employee.
 * For 3-col: writes [status, time, location].
 * For legacy 1-col: writes [status].
 */
export async function markAttendance(employeeName, employeeEmail, day, status, time, location) {
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
  let isNew = isNewThreeColStructure(rows, headerRow)
  if (!isNew) {
    const migrated = await migrateToThreeCol(sheets, tab)
    if (migrated) {
      rows = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: tab, valueRenderOption: 'FORMATTED_VALUE' }).then(r => r.data.values || [])
      headerRow = findHeaderRow(rows)
      isNew = true
    }
  }

  const rowIdx = findDayRow(rows, headerRow, day)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)

  const t = String(time || '').trim() || new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
  const loc = String(location || '').trim() || 'Unknown'

  if (isNew) {
    const range = `${tab}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 2)}${rowIdx + 1}`
    const written = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status, t, loc]] },
    })
    return written.data.updatedCells > 0
  }

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

export async function listMonthTabs() {
  const sheets = await sheetsClient()
  return listTabs(sheets)
}

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
  const is3col = isNewThreeColStructure(rows, headerRow)
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
      data.push({
        range: `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 2)}${rowIdx + 1}`,
        values: [[normalized, u.time || '', u.location || '']],
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
 * For 3-col: reads Presence, Time, Location per employee.
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
  const is3col = isNewThreeColStructure(rows, headerRow)
  const step = is3col ? COLS_PER_EMPLOYEE : 1
  const employees = []
  for (let c = 2; c < headers.length; c += step) {
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
    for (const emp of employees) {
      const c = findEmployeeColumn(rows, headerRow, emp)
      if (is3col) {
        values[emp] = String(rows[i][c] ?? '').trim()
      } else {
        values[emp] = String(rows[i][c] ?? '').trim()
      }
    }
    days.push({ date: raw, day: String(rows[i][1] ?? '').trim(), values })
  }
  let absentDays = {}
  let total = 0
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (String(rows[i][0] ?? '').trim() === ABSENT_SECTION) {
      for (const emp of employees) {
        const c = findEmployeeColumn(rows, headerRow, emp)
        absentDays[emp] = Number(rows[i][c] ?? 0) || 0
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
  const is3col = isNewThreeColStructure(rows, headerRow)
  const colIdx = findEmployeeColumn(rows, headerRow, employeeName, employeeEmail)
  const rowIdx = findDayRow(rows, headerRow, Number(dayLabel) || dayLabel)

  const allowed = ['', 'Office', 'Home', 'Absent']
  const normalized = String(status ?? '').trim()
  if (!allowed.includes(normalized)) {
    throw new Error(`status must be one of: ${allowed.filter(Boolean).join(', ')} or empty`)
  }

  if (is3col) {
    const range = `${title}!${columnLetter(colIdx)}${rowIdx + 1}:${columnLetter(colIdx + 2)}${rowIdx + 1}`
    const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date())
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[normalized, t, 'Unknown']] },
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

export async function ensureEmployeeTabForUser(employeeName, employeeEmail) {
  if (!hasGoogleCredentials() || !SPREADSHEET_ID) return
  const sheets = await sheetsClient()
  const tab = await ensureMonthTab(sheets)
  await ensureEmployeeColumn(sheets, tab, employeeName, employeeEmail)
  await loadGrid(sheets, tab)
}
