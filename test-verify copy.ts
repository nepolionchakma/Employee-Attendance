import { google } from 'googleapis'
import * as fs from 'fs'

const creds = JSON.parse(fs.readFileSync('service-account.json', 'utf8'))
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })
const SID = process.env.SPREADSHEET_ID!

const users = [
  { name: 'Nepolion Chakma', email: 'nepolionchakma.nc@gmail.com' },
  { name: 'Nepolion Chakma', email: 'nepockma@gmail.com' },
  { name: 'Kallany Chakma', email: 'kallanychakma@gmail.com' },
  { name: 'Rahim Uddin', email: 'rahim@gmail.com' },
  { name: 'Fatima Begum', email: 'fatima@gmail.com' },
  { name: 'Karim Khan', email: 'karim@gmail.com' },
  { name: 'Salma Akter', email: 'salma@gmail.com' },
  { name: 'Jamal Hossain', email: 'jamal@gmail.com' },
  { name: 'Nasrin Akhter', email: 'nasrin@gmail.com' },
  { name: 'Faruk Islam', email: 'faruk@gmail.com' },
]

async function run() {
  // Delete old tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SID })
  const old = meta.data.sheets?.find(s => s.properties?.title === 'September 2026')
  if (old?.properties?.sheetId != null) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [{ deleteSheet: { sheetId: old.properties.sheetId } }] } })
  }

  const mod = await import('./lib/googleSheets')

  // Create all 10 columns
  for (const u of users) {
    await mod.ensureEmployeeTabForUser(u.name, u.email)
  }
  console.log('1. Created 10 employee columns')

  // Mark attendance for today (day 1 = Sept 1)
  const statuses = ['Office', 'Home', 'Office', 'Office', 'Home', 'Office', 'Home', 'Office', 'Office', 'Home']
  for (let i = 0; i < users.length; i++) {
    await mod.markAttendance(users[i].name, users[i].email, 1, statuses[i])
  }
  console.log('2. Marked attendance for all 10 users')

  // Verify all 10
  let allOK = true
  for (let i = 0; i < users.length; i++) {
    const s = await mod.getAttendance(users[i].name, users[i].email, 1)
    const ok = s.attended && s.status === statuses[i]
    if (!ok) { allOK = false; console.log(`  ❌ ${users[i].email}: got ${s.status}, expected ${statuses[i]}`) }
  }
  console.log(`3. Readback: ${allOK ? '✅ ALL 10 CORRECT' : '❌ SOME FAILED'}`)

  // Check grid
  const grid = await mod.getAdminGrid('')
  console.log(`4. Admin grid: ${grid.employees?.length} employees, ${grid.days?.length} days`)

  // Check formulas
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SID, range: 'September 2026', valueRenderOption: 'FORMULA' })
  const rows = res.data.values || []
  let absentIdx = rows.findIndex((r: any) => String(r?.[0] ?? '').trim() === 'Absent Days')
  let totalIdx = rows.findIndex((r: any) => String(r?.[0] ?? '').trim().toLowerCase() === 'total')
  if (absentIdx >= 0) {
    const formulas = rows[absentIdx].slice(2).filter((c: any) => String(c || '').startsWith('=COUNTIF'))
    console.log(`5. Absent row: ${formulas.length} COUNTIF formulas, Total row: ${totalIdx >= 0 ? '❌ EXISTS' : '✅ REMOVED'}`)
  }

  console.log(`\n=== ${allOK ? 'ALL PASS ✅' : 'FAILED ❌'} ===`)
}

run().catch(e => { console.error('Error:', e.message); process.exit(1) })
