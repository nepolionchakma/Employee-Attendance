import { NextRequest, NextResponse } from 'next/server'
import { getAttendanceStatus, markAttendanceStatus } from '@/lib/storage'
import { nowParts, adminCanSubmitAttendance, storeForEmail, getTodayHoliday } from '@/lib/googleSheets'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

const VALID_STATUSES = ['On-site', 'Remote']

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const employeeEmail = String(body?.employeeEmail || body?.email || user.email || '').trim().toLowerCase()
  const employeeName = String(body?.employeeName || body?.name || user.name || '').trim()
  const status = String(body?.status || 'On-site').trim()
  const time = String(body?.time || '').trim()

  if (!employeeEmail && !employeeName) {
    return NextResponse.json({ message: 'employeeEmail or employeeName is required' }, { status: 400 })
  }
  if (!user.isAdmin && employeeEmail.toLowerCase() !== String(user.email).toLowerCase()) {
    return NextResponse.json({ message: 'Forbidden: can only mark own attendance' }, { status: 403 })
  }
  // Env toggle: ADMIN_CAN_SUBMIT_ATTENDANCE=no blocks admins from submitting
  // (they can still manage all sheets). Non-admins always submit to their own store.
  if (user.isAdmin && !adminCanSubmitAttendance()) {
    return NextResponse.json(
      { message: 'Admin attendance submission is disabled (ADMIN_CAN_SUBMIT_ATTENDANCE=no).' },
      { status: 403 },
    )
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const { date, day } = nowParts()

    // Holidays (from the admin spreadsheet's 'Holiday List') close the day for
    // everyone, including admins — nothing is expected to be marked.
    const holiday = await getTodayHoliday()
    if (holiday) {
      return NextResponse.json(
        {
          holiday: true,
          holidayName: holiday.name,
          message: `Today is a holiday (${holiday.name}) — attendance submission is disabled.`,
        },
        { status: 403 },
      )
    }

    const existing = await getAttendanceStatus({ employeeName, employeeEmail, day })
    if (existing.attended) {
      return NextResponse.json(
        {
          attended: true,
          status: existing.status,
          message: `${employeeName || employeeEmail} already attended today (${existing.status ?? 'marked'})`,
        },
        { status: 409 },
      )
    }

    await markAttendanceStatus({ employeeName, employeeEmail, day, status, time })
    const store = await storeForEmail(employeeEmail).catch(() => 'employee' as const)
    return NextResponse.json({
      attended: false,
      employee: employeeName,
      email: employeeEmail,
      date,
      status,
      time,
      store,
      message: `${employeeName || employeeEmail} marked as ${status} for today (${date})`,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('POST /api/attendance failed:', msg)
    return NextResponse.json(
      { message: 'Could not mark attendance. ' + msg },
      { status: 500 },
    )
  }
}
