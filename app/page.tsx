import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AttendanceForm from './attendance-form'
import Navbar from './components/Navbar'
import HomeSummaryTable from './components/HomeSummaryTable'

export const metadata = {
  title: 'Datafluent BD — Online Daily Attendance Management',
  description:
    'Track daily attendance for students, teachers, and staff. Record office and home presence, view monthly summaries, and manage attendance online from any device.',
  keywords: ['Datafluent BD attendance', 'attendance management', 'online attendance', 'daily attendance', 'staff attendance', 'student attendance', 'employee attendance'],
  openGraph: {
    title: 'Datafluent BD — Online Daily Attendance Management',
    description:
      'Track daily attendance for students, teachers, and staff. Record office and home presence, view monthly summaries, and manage attendance online from any device.',
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

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  let summary: { monthLabel: string; stats: SummaryStat[] } | null = null
  try {
    const { hasGoogleCredentials, getAdminGrid, getEmployees, parseHeaderEmail, parseHeaderName } = await import('@/lib/googleSheets')
    if (hasGoogleCredentials()) {
      const [grid, directory] = await Promise.all([getAdminGrid(''), getEmployees()])
      if (grid?.employees) {
        const days = grid.days || []
        const absentDays: Record<string, number> = grid.absentDays || {}
        const headerByEmail = new Map<string, string>()
        for (const h of grid.employees || []) {
          const em = parseHeaderEmail(h)
          if (em) headerByEmail.set(em.toLowerCase(), h)
        }
        const source = directory && directory.length ? directory : (grid.employees || []).map((h: string) => ({
          name: parseHeaderName(h),
          email: parseHeaderEmail(h) || '',
        }))
        const stats = source.map((m: { name?: string; email?: string }) => {
          const email = String(m.email || '').trim().toLowerCase()
          const name = String(m.name || '').trim() || (email ? email.split('@')[0] : '')
          const header = email ? headerByEmail.get(email) || null : null
          let present = 0
          let absent = 0
          if (header) {
            for (const d of days) {
              const v = String(d.values?.[header] || '').trim()
              if (v === 'Office' || v === 'Home' || v.startsWith('Office - ') || v.startsWith('Home - ')) present++
            }
            absent = Number((absentDays as Record<string, number>)[header] ?? 0)
          }
          return { employee: header || `${name} <${email}>`, name, email, present, absent, total: present + absent, hasColumn: !!header }
        })
        summary = { monthLabel: grid.tab, stats }
      }
    }
  } catch (e) {
    console.error('Home summary failed:', (e as Error).message)
  }

  const displayStats: SummaryStat[] = (() => {
    if (!summary?.stats?.length) return []
    if (user.isAdmin) return summary.stats
    const ownEmail = String(user.email || '').trim().toLowerCase()
    const own = summary.stats.find((s) => s.email && s.email.toLowerCase() === ownEmail)
    return own ? [own] : []
  })()

  const ownMissing = !user.isAdmin && (summary?.stats?.length ?? 0) > 0 && displayStats.length === 0

  return (
    <>
      <Navbar user={user} />
      <div className="page">
        {summary ? (
          <div className="card home-summary-card">
            <div className="home-summary-header">
              <h3>{user.isAdmin ? 'Attendance' : 'Your Attendance'} — {summary.monthLabel}</h3>
              <span className="home-summary-sub">
                {user.isAdmin ? 'Current month summary for all employees' : 'Your current month summary'}
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

        <AttendanceForm employeeName={user.name} employeeEmail={user.email} />
      </div>
    </>
  )
}
