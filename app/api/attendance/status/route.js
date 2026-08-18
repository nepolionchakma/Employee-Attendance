import { NextResponse } from 'next/server'
import { getAttendanceStatus } from '@/lib/storage'
import { nowParts } from '@/lib/googleSheets'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Status for the currently selected employee, so the page can show
// "already attended" before the user submits.
export async function GET(request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  }

  const employeeName = String(request.nextUrl.searchParams.get('employee') || '').trim()
  if (!employeeName) {
    return NextResponse.json({ message: 'employee is required' }, { status: 400 })
  }

  try {
    const { date, day } = nowParts()
    const result = await getAttendanceStatus(employeeName, day)
    return NextResponse.json({ employee: employeeName, date, ...result })
  } catch (error) {
    console.error('GET /api/attendance/status failed:', error.message)
    return NextResponse.json(
      { message: 'Could not read attendance. ' + error.message },
      { status: 500 },
    )
  }
}