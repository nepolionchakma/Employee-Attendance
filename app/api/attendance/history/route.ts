import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

const TZ = 'Asia/Dhaka'

export interface HistoryDay {
  status: string
  time: string
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/**
 * Per-day attendance for the signed-in user, for the month calendar on the
 * home page. Only the caller's own column is read — never another member's.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })

  const {
    hasGoogleCredentials,
    getAdminGrid,
    getHolidaysInMonth,
    listMonthTabs,
    parseHeaderEmail,
    parseHeaderName,
    nowParts,
    storeForEmail,
  } = await import('@/lib/googleSheets')

  const qp = request.nextUrl.searchParams
  const now = nowParts()
  const yearParam = Number(qp.get('year'))
  const monthParam = Number(qp.get('month'))
  const year = Number.isInteger(yearParam) && yearParam > 1970 ? yearParam : now.year
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.month

  const email = String(user.email || '').trim().toLowerCase()
  const name = String(user.name || '').trim()
  const daysInMonth = new Date(year, month, 0).getDate()
  const base = {
    email,
    year,
    month,
    monthLabel: monthLabel(year, month),
    daysInMonth,
    // 0 = Sunday, so the calendar can pad the first week.
    firstWeekday: new Date(year, month - 1, 1).getDay(),
    today: { year: now.year, month: now.month, day: now.day },
    days: {} as Record<string, HistoryDay>,
    // Day number -> holiday name, from the admin spreadsheet's 'Holiday List'.
    holidays: (await getHolidaysInMonth(year, month).catch(() => ({}))) as Record<string, string>,
  }

  // Dev fallback: without Google credentials the in-memory store only knows the
  // current month (keys are day numbers with no month), so history is limited
  // to today's month.
  if (!hasGoogleCredentials()) {
    const isCurrentMonth = year === now.year && month === now.month
    const days: Record<string, HistoryDay> = {}
    if (isCurrentMonth) {
      const { getAttendanceStatus } = await import('@/lib/storage')
      for (let d = 1; d <= now.day; d++) {
        const result = await getAttendanceStatus({ employeeName: name, employeeEmail: email, day: d })
        if (result.attended && result.status) {
          days[String(d)] = { status: result.status, time: result.time || '' }
        }
      }
    }
    return NextResponse.json({ ...base, tabExists: isCurrentMonth, hasColumn: isCurrentMonth, days })
  }

  try {
    // Route to the caller's own sheet (Admin / Employee / Bootcamp) like the
    // attendance writes do, and only read the month tab if it exists yet.
    const store = await storeForEmail(email).catch(() => 'employee' as const)
    const tabs = await listMonthTabs(store)
    const tab = monthLabel(year, month)
    if (!tabs.includes(tab)) {
      return NextResponse.json({ ...base, tabExists: false, hasColumn: false })
    }

    const grid = await getAdminGrid(tab, store)
    const employees: string[] = grid.employees || []
    const header =
      employees.find((h) => parseHeaderEmail(h) === email) ||
      (name ? employees.find((h) => parseHeaderName(h).trim().toLowerCase() === name.toLowerCase()) : undefined)
    if (!header) {
      return NextResponse.json({ ...base, tabExists: true, hasColumn: false })
    }

    const days: Record<string, HistoryDay> = {}
    for (const entry of grid.days || []) {
      const status = String(entry.values?.[header] ?? '').trim()
      if (!status) continue
      days[String(entry.date)] = { status, time: String(entry.timeValues?.[header] ?? '').trim() }
    }
    return NextResponse.json({ ...base, tabExists: true, hasColumn: true, tab: grid.tab, days })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('GET /api/attendance/history failed:', msg)
    return NextResponse.json({ message: 'Could not load attendance history. ' + msg }, { status: 500 })
  }
}
