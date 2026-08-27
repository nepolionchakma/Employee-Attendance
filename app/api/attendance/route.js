import { NextResponse } from 'next/server'
import { getAttendanceStatus, markAttendanceStatus } from '@/lib/storage'
import { nowParts } from '@/lib/googleSheets'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

const VALID_STATUSES = ['Office', 'Home']

// Mark attendance for today. Duplicate (same employee + same day) is rejected.
export async function POST(request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const employeeEmail = String(body?.employeeEmail || body?.email || user.email || '').trim().toLowerCase()
  const employeeName = String(body?.employeeName || body?.name || user.name || '').trim()
  const status = String(body?.status || 'Office').trim()

  if (!employeeEmail && !employeeName) {
    return NextResponse.json({ message: 'employeeEmail or employeeName is required' }, { status: 400 })
  }
  if (!user.isAdmin && employeeEmail.toLowerCase() !== String(user.email).toLowerCase()) {
    return NextResponse.json({ message: 'Forbidden: can only mark own attendance' }, { status: 403 })
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const { date, day, time } = nowParts()

    const existing = await getAttendanceStatus(employeeName, employeeEmail, day)
    if (existing.attended) {
      return NextResponse.json(
        {
          attended: true,
          status: existing.status,
          message: `${employeeName || employeeEmail} already attended today (${existing.status}) at ${time}`,
        },
        { status: 409 },
      )
    }

    await markAttendanceStatus(employeeName, employeeEmail, day, status)
    return NextResponse.json({
      attended: false,
      employee: employeeName,
      email: employeeEmail,
      date,
      status,
      message: `${employeeName || employeeEmail} marked as ${status} for today (${date})`,
    })
  } catch (error) {
    console.error('POST /api/attendance failed:', error.message)
    return NextResponse.json(
      { message: 'Could not mark attendance. ' + error.message },
      { status: 500 },
    )
  }
}