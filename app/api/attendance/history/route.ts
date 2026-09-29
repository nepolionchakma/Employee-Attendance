import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

const TZ = 'Asia/Dhaka'

export interface HistoryDay {
  status: string
  time: string
  location?: string
}

/**
 * Short server cache + in-flight dedupe so rapid month switching (or several
 * tabs open at once) doesn't burn the Sheets "60 reads / minute" quota.
 * One history view costs several Sheets reads (members + holidays + grid), so
 * ~10 quick clicks used to exceed the quota on its own.
 */
const HISTORY_CACHE_TTL = 90 * 1000
const historyCache = new Map<string, { at: number; payload: unknown }>()
const historyInflight = new Map<string, Promise<unknown>>()

function isQuotaError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const code = (error as { code?: unknown })?.code
  return (
    code === 429 ||
    msg.includes('Quota exceeded') ||
    msg.includes('Read requests per minute') ||
    msg.includes('sheets.googleapis.com')
  )
}

function quotaResponse() {
  return NextResponse.json(
    {
      message:
        'Attendance history is temporarily rate-limited by Google Sheets (60 reads/minute shared quota). Please wait about a minute, then try again — avoid clicking through months rapidly.',
    },
    { status: 429, headers: { 'Retry-After': '60' } },
  )
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
          days[String(d)] = { status: result.status, time: result.time || '', location: result.location || '' }
        }
      }
    }
    return NextResponse.json({ ...base, holidays: {}, tabExists: isCurrentMonth, hasColumn: isCurrentMonth, days })
  }

  const cacheKey = `${email}::${year}-${month}`
  const cached = historyCache.get(cacheKey)
  if (cached && Date.now() - cached.at < HISTORY_CACHE_TTL) {
    return NextResponse.json(cached.payload)
  }
  const inflight = historyInflight.get(cacheKey)
  if (inflight) {
    try {
      return NextResponse.json(await inflight)
    } catch {
      // Fall through and try a fresh load below.
    }
  }

  const load = (async () => {
    // Members directory + holidays run in parallel (both are cached 5 min in
    // lib/googleSheets). The grid itself is a pure read — readonly skips the
    // auto-absent fill / summary writes that used to cost extra quota.
    const [store, holidays] = await Promise.all([
      storeForEmail(email).catch(() => 'employee' as const),
      getHolidaysInMonth(year, month).catch(() => ({}) as Record<string, string>),
    ])
    const tab = monthLabel(year, month)
    let grid: Awaited<ReturnType<typeof getAdminGrid>>
    try {
      grid = await getAdminGrid(tab, store, { readonly: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // getAdminGrid already checks tab existence, so a missing tab needs no
      // extra listTabs read.
      if (msg.includes('not found')) {
        return { ...base, holidays, tabExists: false, hasColumn: false }
      }
      throw error
    }

    const employees: string[] = grid.employees || []
    const header =
      employees.find((h) => parseHeaderEmail(h) === email) ||
      (name ? employees.find((h) => parseHeaderName(h).trim().toLowerCase() === name.toLowerCase()) : undefined)
    if (!header) {
      return { ...base, holidays, tabExists: true, hasColumn: false }
    }

    const days: Record<string, HistoryDay> = {}
    for (const entry of grid.days || []) {
      const status = String(entry.values?.[header] ?? '').trim()
      if (!status) continue
      days[String(entry.date)] = {
        status,
        time: String(entry.timeValues?.[header] ?? '').trim(),
        location: String(entry.locationValues?.[header] ?? '').trim(),
      }
    }
    return { ...base, holidays, tabExists: true, hasColumn: true, tab: grid.tab, days }
  })()

  historyInflight.set(cacheKey, load)
  try {
    const payload = await load
    historyCache.set(cacheKey, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('GET /api/attendance/history failed:', msg)
    if (isQuotaError(error)) return quotaResponse()
    return NextResponse.json({ message: 'Could not load attendance history. ' + msg }, { status: 500 })
  } finally {
    if (historyInflight.get(cacheKey) === load) historyInflight.delete(cacheKey)
  }
}
