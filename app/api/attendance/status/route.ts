import { NextRequest, NextResponse } from 'next/server'
import { getAttendanceStatus } from '@/lib/storage'
import { nowParts, getTodayHoliday } from '@/lib/googleSheets'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Status for the currently selected employee, so the page can show
// "already attended" before the user submits.
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  }

  const qp = request.nextUrl.searchParams
  const employeeEmail = String(qp.get('email') || qp.get('employeeEmail') || '').trim().toLowerCase()
  const employeeName = String(qp.get('employee') || qp.get('name') || '').trim()
  const email = employeeEmail || String(user.email || '').trim().toLowerCase()
  const name = employeeName || String(user.name || '').trim()
  if (!email && !name) {
    return NextResponse.json({ message: 'email or employee is required' }, { status: 400 })
  }

  try {
    const { date, day } = nowParts()
    // A holiday (from the admin spreadsheet's 'Holiday List') closes the day:
    // the form disables the submit button instead of checking for a record.
    const holiday = await getTodayHoliday()
    if (holiday) {
      return NextResponse.json({
        employee: name,
        email,
        date,
        attended: false,
        holiday: true,
        holidayName: holiday.name,
        message: `Today is a holiday (${holiday.name}) — attendance is not needed.`,
      })
    }
    const result = await getAttendanceStatus({ employeeName: name, employeeEmail: email, day })
    return NextResponse.json({ employee: name, email, date, holiday: false, ...result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('GET /api/attendance/status failed:', msg)
    return NextResponse.json(
      { message: 'Could not read attendance. ' + msg },
      { status: 500 },
    )
  }
}
