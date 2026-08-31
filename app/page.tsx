// @ts-nocheck
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AttendanceForm from './attendance-form'
import Navbar from './components/Navbar'
import HomeSummaryTable from './components/HomeSummaryTable'
import LocationGate from './components/LocationGate'

export const metadata = { title: 'Attendance' }

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  let summary = null
  try {
    const { hasGoogleCredentials, getAdminGrid, getEmployees, parseHeaderEmail, parseHeaderName } = await import('@/lib/googleSheets')
    if (hasGoogleCredentials()) {
      const [grid, directory] = await Promise.all([getAdminGrid(''), getEmployees()])
      if (grid?.kind === 'attendance' || grid?.employees) {
        const days = grid.days || []
        const absentDays = grid.absentDays || {}
        const headerByEmail = new Map()
        for (const h of grid.employees || []) {
          const em = parseHeaderEmail(h)
          if (em) headerByEmail.set(em.toLowerCase(), h)
        }
        const source = directory && directory.length ? directory : (grid.employees || []).map((h) => ({
          name: parseHeaderName(h),
          email: parseHeaderEmail(h) || '',
        }))
        const stats = source.map((m) => {
          const email = String(m.email || '').trim().toLowerCase()
          const name = String(m.name || '').trim() || (email ? email.split('@')[0] : '')
          let header = email ? headerByEmail.get(email) : null
          if (!header) {
            header = (grid.employees || []).find((h) => parseHeaderName(h).toLowerCase() === name.toLowerCase()) || null
          }
          let present = 0
          let absent = 0
          if (header) {
            for (const d of days) {
              const v = String(d.values?.[header] || '').trim()
              if (v === 'Office' || v === 'Home') present++
            }
            absent = Number(absentDays[header] ?? 0)
          }
          return { employee: header || `${name} <${email}>`, name, email, present, absent, total: present + absent, hasColumn: !!header }
        })
        summary = { monthLabel: grid.tab, stats }
      }
    }
  } catch (e) {
    console.error('Home summary failed:', e.message)
  }

  const displayStats = (() => {
    if (!summary?.stats?.length) return []
    if (user.isAdmin) return summary.stats
    const ownEmail = String(user.email || '').trim().toLowerCase()
    let own = summary.stats.find((s) => s.email && s.email.toLowerCase() === ownEmail)
    if (!own) {
      own = summary.stats.find((s) => s.name.trim().toLowerCase() === String(user.name).trim().toLowerCase())
    }
    return own ? [own] : []
  })()

  const ownMissing = !user.isAdmin && summary?.stats?.length > 0 && displayStats.length === 0

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

        <LocationGate>
          <AttendanceForm employeeName={user.name} employeeEmail={user.email} />
        </LocationGate>
      </div>
    </>
  )
}
