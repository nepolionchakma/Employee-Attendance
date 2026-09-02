import { NextRequest, NextResponse } from 'next/server'
import { getAttendanceStatus } from '@/lib/storage'
import { nowParts } from '@/lib/googleSheets'
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
    const result = await getAttendanceStatus({ employeeName: name, employeeEmail: email, day })
    return NextResponse.json({ employee: name, email, date, ...result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('GET /api/attendance/status failed:', msg)
    return NextResponse.json(
      { message: 'Could not read attendance. ' + msg },
      { status: 500 },
    )
  }
}
