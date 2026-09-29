import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AttendanceForm from './attendance-form'
import LocationGate from './components/LocationGate'
import Navbar from './components/Navbar'
import HomeSummaryTable from './components/HomeSummaryTable'
import AttendanceHistory from './components/AttendanceHistory'

export const metadata = {
  title: 'Datafluent BD — Online Daily Attendance Management',
  description:
    'Track daily attendance for bootcamp members and staff. Record office and home presence, view monthly summaries, and manage attendance online from any device.',
  keywords: ['Datafluent BD attendance', 'attendance management', 'online attendance', 'daily attendance', 'staff attendance', 'student attendance', 'employee attendance'],
  openGraph: {
    title: 'Datafluent BD — Online Daily Attendance Management',
    description:
      'Track daily attendance for bootcamp members and staff. Record office and home presence, view monthly summaries, and manage attendance online from any device.',
    type: 'website',
  },
}

interface SummaryStat {
  employee: string
  name: string
  email: string
  present: number
  absent: number
  total: number
  hasColumn: boolean
}

type StoreKey = 'admin' | 'employee' | 'bootcamp'

const STORE_BY_ROLE: Record<string, StoreKey> = {
  admin: 'admin',
  employee: 'employee',
  bootcamp: 'bootcamp',
}

/**
 * Builds the attendance summary. Members come from the Members directory, but
 * each member's counts are read from the sheet their role belongs to (Admin /
 * Employee / Bootcamp), so '(no column found)' only shows for someone who really
 * has no column in their own sheet yet.
 *
 * Admin-role accounts are left out: admins don't mark attendance, so their rows
 * would only ever read as empty. An admin sees everyone else; a member only ever
 * sees their own row.
 */
async function loadSummary(
  user: { isAdmin: boolean },
  ownStore: StoreKey,
): Promise<{ monthLabel: string; stats: SummaryStat[] } | null> {
  const gs = await import('@/lib/googleSheets')
  const directory: { name?: string; email?: string; role?: string }[] = await gs.getEmployees().catch(() => [])

  const requested: StoreKey[] = user.isAdmin ? ['admin', 'employee', 'bootcamp'] : [ownStore]
  const seenIds = new Set<string>()
  const storesToLoad: StoreKey[] = []
  for (const store of requested) {
    const id = gs.spreadsheetIdForStore(store)
    // A store without its own spreadsheet ID falls back to the admin sheet, so
    // skip the duplicate read instead of loading the same grid twice.
    if (!id || seenIds.has(id)) continue
    seenIds.add(id)
    storesToLoad.push(store)
  }

  const loaded: { store: StoreKey; grid: Awaited<ReturnType<typeof gs.getAdminGrid>> }[] = []
  await Promise.all(
    storesToLoad.map(async (store) => {
      try {
        loaded.push({ store, grid: await gs.getAdminGrid('', store) })
      } catch (e) {
        console.error(`Home summary: could not read the ${store} sheet:`, (e as Error).message)
      }
    }),
  )
  const first = loaded[0]
  if (!first) return null

  const gridFor = (store: StoreKey) => loaded.find((l) => l.store === store)?.grid
  // Never fall back to the admin sheet — those members aren't listed anyway.
  const fallbackStore = loaded.find((l) => l.store !== 'admin')?.store ?? first.store

  // Column lookup per sheet, keyed by the email embedded in each header.
  const headersByStore = new Map<StoreKey, Map<string, string>>()
  for (const { store, grid } of loaded) {
    const map = new Map<string, string>()
    for (const header of grid.employees || []) {
      const email = gs.parseHeaderEmail(header)
      if (email) map.set(email, header)
    }
    headersByStore.set(store, map)
  }

  const storeForRole = (role: string | undefined) => STORE_BY_ROLE[String(role || '').trim().toLowerCase()]

  const entries = directory.length
    ? directory
      .filter((m) => storeForRole(m.role) !== 'admin')
      .map((m) => ({
        name: String(m.name || '').trim(),
        email: String(m.email || '').trim().toLowerCase(),
        store: storeForRole(m.role) || ('employee' as StoreKey),
      }))
    : loaded
      .filter(({ store }) => store !== 'admin')
      .flatMap(({ store, grid }) =>
        (grid.employees || []).map((header) => ({
          name: gs.parseHeaderName(header),
          email: (gs.parseHeaderEmail(header) || '').toLowerCase(),
          store,
        })),
      )

  const stats: SummaryStat[] = entries.map((entry) => {
    const name = entry.name || (entry.email ? entry.email.split('@')[0] : '')
    const store = gridFor(entry.store) ? entry.store : fallbackStore
    const grid = gridFor(store)
    const header = (entry.email && headersByStore.get(store)?.get(entry.email)) || null
    let present = 0
    let absent = 0
    if (header && grid) {
      for (const day of grid.days || []) {
        const value = String(day.values?.[header] || '').trim()
        if (value === 'On-site' || value === 'Remote' || value.startsWith('On-site - ') || value.startsWith('Remote - ')) present++
      }
      absent = Number(grid.absentDays?.[header] ?? 0)
    }
    return {
      employee: header || `${name} <${entry.email}>`,
      name,
      email: entry.email,
      present,
      absent,
      total: present + absent,
      hasColumn: !!header,
    }
  })

  return { monthLabel: gridFor('admin')?.tab || first.grid.tab, stats }
}

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  let summary: { monthLabel: string; stats: SummaryStat[] } | null = null
  // The attendance form labels the user by their Members-directory role. Fall back
  // to the session flag when the directory can't be read (no creds / offline).
  let memberRole: 'Admin' | 'Employee' | 'Bootcamp' = user.isAdmin ? 'Admin' : 'Employee'
  try {
    const gs = await import('@/lib/googleSheets')
    // The form labels the user by their Members-directory role.
    memberRole = (await gs.getRoleForEmail(String(user.email || ''))) || memberRole
    if (gs.hasGoogleCredentials()) {
      // Each role reads its own spreadsheet: Bootcamp -> bootcamp sheet, Employee -> employee sheet.
      const ownStore: StoreKey = await gs
        .storeForEmail(String(user.email || ''))
        .catch(() => (user.isAdmin ? 'admin' : 'employee'))
      summary = await loadSummary(user, ownStore)
    }
  } catch (e) {
    console.error('Home summary failed:', (e as Error).message)
  }

  // Admins manage attendance rather than mark it, so their form is hidden
  // entirely. Set ADMIN_CAN_SUBMIT_ATTENDANCE=yes to bring it back.
  let adminCanSubmit = false
  if (user.isAdmin) {
    try {
      const { adminCanSubmitAttendance } = await import('@/lib/googleSheets')
      adminCanSubmit = adminCanSubmitAttendance()
    } catch {
      adminCanSubmit = false
    }
  }

  // Admins see every member except admin-role accounts (already dropped in
  // loadSummary); a member only ever sees their own row.
  const ownEmail = String(user.email || '').trim().toLowerCase()
  const displayStats: SummaryStat[] = user.isAdmin
    ? summary?.stats ?? []
    : (summary?.stats ?? []).filter((s) => s.email && s.email.toLowerCase() === ownEmail)
  const ownMissing = !user.isAdmin && (summary?.stats?.length ?? 0) > 0 && displayStats.length === 0

  return (
    <>
      <Navbar user={user} />
      <div className="page">
        {summary ? (
          <div className="card home-summary-card">
            <div className="home-summary-header">
              <div className="home-title-row">
                <h3>{user.isAdmin ? 'Attendance' : 'My Attendance'} - {summary.monthLabel}</h3>
                {/* The calendar is the signed-in user's own attendance — admins don't see theirs. */}
                {!user.isAdmin && <AttendanceHistory />}
              </div>
              <span className="home-summary-sub">
                {user.isAdmin ? 'Current month summary for all members (admins excluded)' : 'Your current month summary'}
              </span>
            </div>

            {displayStats.length === 0 ? (
              <p className="home-summary-empty">
                {ownMissing
                  ? 'No attendance column found for your account yet — mark attendance below to create it.'
                  : 'No attendance data yet.'}
              </p>
            ) : (
              <HomeSummaryTable stats={displayStats} user={user} />
            )}
          </div>
        ) : (
          <div className="card home-summary-card">
            <p className="home-summary-empty">Attendance summary not available (sheets not configured).</p>
          </div>
        )}

        {/* Permission can be revoked after signing in, so the form itself is gated:
            without location the submit button stays blocked and the modal explains why.
            Admins mark nothing at all — no summary, no form — so nothing renders for them. */}
        {(!user.isAdmin || adminCanSubmit) && (
          <LocationGate reason="attendance">
            <AttendanceForm employeeName={user.name} employeeEmail={user.email} role={memberRole} />
          </LocationGate>
        )}
      </div>
    </>
  )
}
