/**
 * READ-ONLY diagnostic for the auto-absent fill. Writes NOTHING.
 *
 * Reports, for each configured store, what the current month tab actually holds:
 * header/names row shapes, every employee column found, how many past-day cells
 * are filled vs empty, and the Absent Days row.
 *
 * Run:  node --env-file=.env scripts/inspect-month-tab.mjs
 */
import fs from 'node:fs'

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
const AUTO = (process.env.AUTO_ABSENT_TIME || '12:00 AM').trim() || '12:00 AM'

if (!ADMIN_ID) {
  console.log('MISSING admin spreadsheet id')
  process.exit(2)
}

const { google } = await import('googleapis')

function loadCreds() {
  const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()
  if (inline.startsWith('{')) return JSON.parse(inline)
  const b64 = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim()
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return JSON.parse(fs.readFileSync('service-account.json', 'utf8'))
}

const auth = new google.auth.GoogleAuth({ credentials: loadCreds(), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth })

const cell = (v) => String(v ?? '').trim()
const TZ = 'Asia/Dhaka'
const today = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' }).format(new Date()))
const now = new Date()
const monthTab = PINNED_TAB || new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'long' }).format(now)
console.log(`today(Dhaka) = ${today} | month tab = "${monthTab}" | AUTO_ABSENT_TIME = "${AUTO}"`)
console.log(`spreadsheets: admin=${ADMIN_ID ? 'set' : '-'} employee=${EMPLOYEE_ID ? 'set' : '-'} bootcamp=${BOOTCAMP_ID ? 'set' : '-'}`)

const parseEmail = (h) => {
  const m = String(h || '').match(/<([^>]+@[^>]+)>/)
  if (m) return m[1].trim().toLowerCase()
  const s = cell(h)
  return s.includes('@') && !s.includes(' ') ? s.toLowerCase() : ''
}

async function readValues(spreadsheetId, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' })
  return res.data.values || []
}

const stores = [
  { store: 'admin', id: ADMIN_ID, expected: 'Admin' },
  { store: 'employee', id: EMPLOYEE_ID, expected: 'Employee' },
  { store: 'bootcamp', id: BOOTCAMP_ID, expected: 'Bootcamp' },
].filter((s) => s.id)

// Members directory for reference
let directory = []
try {
  const rows = await readValues(ADMIN_ID, 'Members!A1:E')
  directory = rows.slice(1).filter((r) => cell(r[1]).includes('@')).map((r) => ({ name: cell(r[0]), email: cell(r[1]).toLowerCase(), role: cell(r[3]) || 'Employee' }))
  console.log(`\nMembers: ${directory.length} (Admin ${directory.filter((m) => m.role === 'Admin').length}, Employee ${directory.filter((m) => m.role === 'Employee').length}, Bootcamp ${directory.filter((m) => m.role === 'Bootcamp').length})`)
} catch (e) {
  console.log(`\nMembers read failed: ${e.message}`)
}

for (const s of stores) {
  console.log(`\n===== ${s.store} sheet (expected role ${s.expected}) =====`)
  let tabs = []
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: s.id, fields: 'sheets.properties.title' })
    tabs = meta.data.sheets.map((x) => x.properties.title)
  } catch (e) {
    console.log(`  ERROR listing tabs: ${e.message}`)
    continue
  }
  console.log(`  tabs: ${tabs.join(', ')}`)
  if (!tabs.includes(monthTab)) {
    console.log(`  tab "${monthTab}" NOT PRESENT`)
    continue
  }

  const rows = await readValues(s.id, monthTab)
  const headerRow = rows.findIndex((r) => cell(r[0]) === 'Date')
  if (headerRow === -1) {
    console.log('  no "Date" header row — raw/non-attendance sheet. First rows:')
    for (let i = 0; i < Math.min(4, rows.length); i++) {
      console.log(`    row ${i + 1}: ${JSON.stringify((rows[i] || []).slice(0, 10))}`)
    }
    console.log(`  total rows=${rows.length}`)
    continue
  }
  const above = rows[headerRow - 1] || []
  const aboveHasEmail = above.some((c) => cell(c).includes('@'))
  const aboveIsTimestamp = cell(above[0]).toLowerCase() === 'timestamp'
  const namesRow = aboveHasEmail || aboveIsTimestamp ? headerRow - 1 : headerRow
  const headerCells = rows[headerRow] || []
  const nameCells = rows[namesRow] || []

  console.log(`  headerRow idx=${headerRow} len=${headerCells.length} (parity ${headerCells.length % 2 === 0 ? 'even' : 'ODD'})`)
  console.log(`  namesRow  idx=${namesRow} len=${nameCells.length} (above: email=${aboveHasEmail} timestamp=${aboveIsTimestamp})`)

  // Where are Presence/Location headers, and do they sit on the expected even grid?
  const oddPresence = []
  for (let c = 2; c < headerCells.length; c++) {
    const h = cell(headerCells[c]).toLowerCase()
    if ((h === 'presence' || h === 'location' || h === 'status' || h === 'time') && c % 2 !== 0 && h !== 'location') {
      oddPresence.push(`col ${c} (${cell(headerCells[c])})`)
    }
  }
  if (oddPresence.length) console.log(`  !! misaligned headers at odd cols: ${oddPresence.join(', ')}`)

  const empCols = []
  for (let c = 2; c < nameCells.length; c += 2) {
    const name = cell(nameCells[c])
    if (name) empCols.push({ col: c, name, email: parseEmail(name) })
  }
  console.log(`  employee columns (even grid): ${empCols.length}`)
  for (const e of empCols) {
    console.log(`    col ${String(e.col).padStart(3)}  header="${cell(headerCells[e.col])}" / "${cell(headerCells[e.col + 1])}"  name="${e.name}"  email=${e.email || '(none)'}`)
  }

  // Past-day fill state per employee column
  const dayRows = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const d = Number(rows[i][0])
    if (!Number.isInteger(d)) break
    dayRows.push(i)
  }
  const pastRows = dayRows.filter((i) => Number(rows[i][0]) < today)
  console.log(`  day rows=${dayRows.length} past-day rows=${pastRows.length}`)
  console.log(`  date cell samples: ${dayRows.slice(0, 3).map((i) => JSON.stringify(rows[i][0])).join(', ')} (typeof ${typeof rows[dayRows[0]]?.[0]})`)

  for (const e of empCols) {
    let filled = 0
    let empty = 0
    let holiday = 0
    const empties = []
    for (const i of pastRows) {
      const v = cell(rows[i][e.col])
      const dayName = cell(rows[i][1])
      if (!v) {
        empty++
        empties.push(`day ${cell(rows[i][0])}${dayName === 'Fri' ? '(Fri)' : ''}`)
      } else if (v.toLowerCase().startsWith('absent')) filled++
      else if (v === 'Holiday') holiday++
      else filled++
    }
    console.log(`    col ${e.col} ${e.email || e.name}: absent=${filled} holiday=${holiday} EMPTY=${empty}${empty ? ` -> ${empties.slice(0, 6).join(', ')}${empties.length > 6 ? '…' : ''}` : ''}`)
  }

  // Absent Days row
  const absentIdx = rows.findIndex((r) => cell(r[0]) === 'Absent Days')
  if (absentIdx === -1) console.log('  Absent Days row: MISSING')
  else {
    const sample = empCols.slice(0, 5).map((e) => `${e.col}:${JSON.stringify(cell(rows[absentIdx][e.col]))}`).join(' ')
    console.log(`  Absent Days row idx=${absentIdx} samples ${sample}`)
  }
}
