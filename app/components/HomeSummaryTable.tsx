'use client'

interface StatRow {
  employee: string
  name: string
  email: string
  present: number
  absent: number
  total: number
  hasColumn: boolean
}

interface HomeSummaryUser {
  name: string
  email: string
  isAdmin: boolean
}

/**
 * Attendance summary rows. The list is not paginated — it scrolls inside a
 * viewport-height box (see .home-summary-wrap), with the header row kept in
 * view, so every row stays reachable without page-by-page clicking.
 */
export default function HomeSummaryTable({ stats, user }: { stats: StatRow[]; user: HomeSummaryUser }) {
  if (!stats.length) return null

  return (
    <div className="home-summary-wrap">
      <table className="home-summary-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Present</th>
            <th>Absent</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((row) => {
            const isOwn = row.email && row.email.toLowerCase() === String(user.email).toLowerCase()
            return (
              <tr key={row.employee} className={isOwn ? 'home-summary-own' : ''} title={row.email}>
                <td className="home-employee-cell">
                  <span>{row.name}</span>
                  {!row.hasColumn && <span className="home-nocol-badge">(no column found)</span>}
                  {isOwn && user.isAdmin && <span className="home-you-badge">You</span>}
                </td>
                <td className="home-present">{row.present}</td>
                <td className="home-absent">{row.absent}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
