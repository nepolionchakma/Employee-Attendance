/**
 * Verification test for auto-absent (Presence + Time format) + custom AUTO_ABSENT_TIME.
 * Isolated: works ONLY on a scratch tab. The submit/getAttendance phase runs in a
 * child process with ATTENDANCE_SHEET_TAB=<scratch> so the live month tab is never touched.
 *
 * One command (runs all phases):  yarn verify:absent
 */
const mode = process.argv[2] || 'setup'
const AUTO = (process.env.AUTO_ABSENT_TIME || '12:00 AM').trim() || '12:00 AM'
const TZ = 'Asia/Dhaka'
const today = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' }).format(new Date()))
const weekdayOf = (d) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(2026, 8, d, 12))
const STATE_FILE = 'scripts/.verify-state.json'

const { google } = await import('googleapis')
const fs = await import('node:fs')
const creds = JSON.parse(fs.readFileSync('service-account.json', 'utf8'))
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })
const SID = process.env.SPREADSHEET_ID

let failed = 0
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed++
}
const cell = (v) => String(v ?? '').trim()

// One-command mode: setup -> submit -> check, then report.
if (mode === 'all') {
  const { spawnSync } = await import('node:child_process')
  const self = process.argv[1]
  const runPhase = (phase, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [self, phase], {
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
    })
    if (r.stdout) process.stdout.write(r.stdout)
    if (r.stderr) process.stderr.write(r.stderr)
    return r
  }

  const setup = runPhase('setup')
  if (setup.status !== 0) {
    console.log('\n=== FULL RUN: FAILED (setup) ❌ ===')
    process.exit(1)
  }

  const { tab: scratch } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const submit = runPhase('submit', { ATTENDANCE_SHEET_TAB: scratch })
  if (submit.status !== 0) {
    console.log('\n=== FULL RUN: FAILED (submit) ❌ ===')
    process.exit(1)
  }
  const jsonLine = (submit.stdout.split('\n').find((l) => l.startsWith('{')) || '{}').trim()
  console.log('SUBMIT OUT:', jsonLine)

  const check = runPhase('check', { SUBMIT_OUT: jsonLine })
  const pass = check.status === 0 && !/FAILED/.test(check.stdout || '')
  console.log(pass ? '\n=== FULL RUN: ALL PASS ✅ ===' : '\n=== FULL RUN: FAILED ❌ ===')
  process.exit(pass ? 0 : 1)
}

if (mode === 'setup') {
  const mod = await import('../lib/googleSheets.ts')
  const name = `zz-test-presence-${Date.now() % 100000}`
  fs.writeFileSync(STATE_FILE, JSON.stringify({ tab: name }))
  console.log(`Custom AUTO_ABSENT_TIME = "${AUTO}" | today(Sept) = ${today} | scratch = ${name}\n`)

  await mod.recreateAttendanceTab(name, [{ name: 'Test User', email: 'testuser.verify@gmail.com' }])
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SID, range: name, valueRenderOption: 'FORMATTED_VALUE' })
  const rows = res.data.values || []
  const dayRow = (d) => rows.findIndex((r) => cell(r[0]) === String(d))

  const presenceCol = rows[1].indexOf('Presence')
  const timeCol = rows[1].indexOf('Time')
  const testCol = rows[0].findIndex((h) => cell(h).includes('testuser.verify@gmail.com'))
  const allMemberCols = rows[0].filter((h) => cell(h).includes('@')).length
  const membersRes = await sheets.spreadsheets.values.get({ spreadsheetId: SID, range: 'Members', valueRenderOption: 'FORMATTED_VALUE' })
  const memberCount = (membersRes.data.values || []).slice(1).filter((r) => cell(r[1]).includes('@')).length

  // 1. Canonical structure: Timestamp row + Presence/Time sub-headers
  ok(cell(rows[0][0]) === 'Timestamp', '1. canonical structure: Timestamp row present')
  ok(presenceCol !== -1 && timeCol === presenceCol + 1, `1. sub-headers are Presence + Time (got "${cell(rows[1][presenceCol])}" / "${cell(rows[1][timeCol])}")`)
  ok(testCol !== -1 && testCol % 2 === 0, `1. Test User column exists at even index ${testCol}`)
  ok(allMemberCols === memberCount + 1, `7. ALL member columns pre-created on new tab (got ${allMemberCols}, members=${memberCount})`)

  // 2. Auto-absent: Presence = 'Absent' (pure), Time = custom AUTO
  const pastDays = []
  for (let d = 1; d < today; d++) pastDays.push(d)
  const firstPast = pastDays.find((d) => weekdayOf(d) !== 'Fri')
  const firstFri = pastDays.find((d) => weekdayOf(d) === 'Fri')
  if (firstPast !== undefined) {
    const r = dayRow(firstPast)
    ok(cell(rows[r][presenceCol]) === 'Absent', `2. past day ${firstPast} Presence = "Absent" (got "${cell(rows[r][presenceCol])}")`)
    ok(cell(rows[r][timeCol]) === AUTO, `2. past day ${firstPast} Time = "${AUTO}" (got "${cell(rows[r][timeCol])}")`)
  }
  // Real member column spot-check
  const memberNamesIdx = rows[0].findIndex((h) => cell(h).includes('arupdas@gmail.com'))
  if (firstPast !== undefined && memberNamesIdx !== -1) {
    const r = dayRow(firstPast)
    ok(cell(rows[r][memberNamesIdx]) === 'Absent', `7. real member Presence = "Absent" (got "${cell(rows[r][memberNamesIdx])}")`)
    ok(cell(rows[r][memberNamesIdx + 1]) === AUTO, `7. real member Time = "${AUTO}" (got "${cell(rows[r][memberNamesIdx + 1])}")`)
  }
  if (firstFri !== undefined) {
    const r = dayRow(firstFri)
    ok(cell(rows[r][presenceCol]) === 'Holiday', `3. Friday ${firstFri} = Holiday`)
    ok(cell(rows[r][timeCol]) === '', '3. Friday Time empty')
  }
  const rToday = dayRow(today)
  ok(cell(rows[rToday]?.[testCol]) === '', '3. today is NOT auto-filled')
  const absentCount = pastDays.filter((d) => weekdayOf(d) !== 'Fri').length
  ok(cell(rows[rows.length - 1][0]) === 'Absent Days' && Number(rows[rows.length - 1][testCol]) === absentCount, `6. Absent Days count=${absentCount} (got "${cell(rows[rows.length - 1][testCol])}")`)
  console.log(failed === 0 ? '\nSETUP PHASE: ALL PASS ✅' : `\nSETUP PHASE: ${failed} FAILED ❌`)
  process.exit(failed === 0 ? 0 : 1)
}

if (mode === 'submit') {
  // Runs with ATTENDANCE_SHEET_TAB=<scratch> so all writes stay on the scratch tab
  const mod = await import('../lib/googleSheets.ts')
  await mod.markAttendance('Test User', 'testuser.verify@gmail.com', today, 'Office', '2:45 PM')
  await mod.markAttendance('Arup Das', 'arupdas@gmail.com', today, 'Home', '9:05 AM')
  const got = await mod.getAttendance('Test User', 'testuser.verify@gmail.com', today)
  const gotPast = await mod.getAttendance('Test User', 'testuser.verify@gmail.com', 1)
  const gotMember = await mod.getAttendance('Arup Das', 'arupdas@gmail.com', today)
  console.log(JSON.stringify({ got, gotPast, gotMember }))
  process.exit(0)
}

if (mode === 'check') {
  const { tab: name } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SID, range: name, valueRenderOption: 'FORMATTED_VALUE' })
  const rows = res.data.values || []
  const dayRow = (d) => rows.findIndex((r) => cell(r[0]) === String(d))
  const rToday = dayRow(today)
  const testCol = rows[0].findIndex((h) => cell(h).includes('testuser.verify@gmail.com'))
  const memberCol = rows[0].findIndex((h) => cell(h).includes('arupdas@gmail.com'))

  ok(cell(rows[rToday][testCol]) === 'Office', `4. submit writes Presence "Office" (got "${cell(rows[rToday][testCol])}")`)
  ok(cell(rows[rToday][testCol + 1]) === '2:45 PM', `4. submit writes Time "2:45 PM" (got "${cell(rows[rToday][testCol + 1])}")`)
  ok(cell(rows[rToday][memberCol]) === 'Home', `4b. member Presence "Home" (got "${cell(rows[rToday][memberCol])}")`)
  ok(cell(rows[rToday][memberCol + 1]) === '9:05 AM', `4b. member Time "9:05 AM" (got "${cell(rows[rToday][memberCol + 1])}")`)

  const out = JSON.parse(process.env.SUBMIT_OUT || '{}')
  ok(out.got?.attended && out.got?.status === 'Office' && out.got?.time === '2:45 PM' && out.got?.location === undefined, `5. getAttendance(today) -> ${JSON.stringify(out.got)}`)
  ok(out.gotPast?.attended && out.gotPast?.status === 'Absent' && out.gotPast?.time === AUTO, `5. getAttendance(past) -> ${JSON.stringify(out.gotPast)}`)
  ok(out.gotMember?.attended && out.gotMember?.status === 'Home' && out.gotMember?.time === '9:05 AM', `5b. getAttendance(member) -> ${JSON.stringify(out.gotMember)}`)

  const absentRow = rows.find((r) => cell(r[0]) === 'Absent Days')
  ok(absentRow && absentRow.length > 0, '6. Absent Days row present')

  // cleanup scratch tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SID })
  const sid = meta.data.sheets.find((s) => s.properties.title === name)?.properties.sheetId
  if (sid != null) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [{ deleteSheet: { sheetId: sid } }] } })
    console.log('(scratch tab deleted)')
  }
  console.log(failed === 0 ? '\nSUBMIT/CHECK PHASE: ALL PASS ✅' : `\nSUBMIT/CHECK PHASE: ${failed} FAILED ❌`)
  process.exit(failed === 0 ? 0 : 1)
}
