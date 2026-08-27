import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AttendanceForm from './attendance-form'
import Navbar from './components/Navbar'

export const metadata = { title: 'Attendance' }

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  let summary = null
  try {
    const { hasGoogleCredentials, getAdminGrid } = await import('@/lib/googleSheets')
    if (hasGoogleCredentials()) {
      const grid = await getAdminGrid('')
      if (grid?.kind === 'attendance' || grid?.employees) {
        const employees = grid.employees || []
        const days = grid.days || []
        const absentDays = grid.absentDays || {}
        const stats = employees.map((emp) => {
          let present = 0
          for (const d of days) {
            const v = String(d.values?.[emp] || '').trim()
            if (v === 'Office' || v === 'Home') present++
          }
          const absent = Number(absentDays[emp] ?? 0)
          return { employee: emp, present, absent, total: present + absent }
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
    const own = summary.stats.find((s) => s.employee.trim().toLowerCase() === user.name.trim().toLowerCase())
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
              <div className="home-summary-wrap">
                <table className="home-summary-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Present</th>
                      <th>Absent</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayStats.map((row) => (
                      <tr key={row.employee} className={row.employee === user.name ? 'home-summary-own' : ''}>
                        <td className="home-employee-cell">
                          {row.employee}
                          {row.employee === user.name && <span className="home-you-badge">You</span>}
                        </td>
                        <td className="home-present">{row.present}</td>
                        <td className="home-absent">{row.absent}</td>
                        <td className="home-total">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="card home-summary-card">
            <p className="home-summary-empty">Attendance summary not available (sheets not configured).</p>
          </div>
        )}

        <AttendanceForm employeeName={user.name} />
      </div>
    </>
  )
}