// @ts-nocheck
'use client'

import { useState, useMemo } from 'react'

function shortName(name) {
  const n = String(name || '')
  return n.length > 11 ? n.slice(0, 11) + '..' : n
}

export default function HomeSummaryTable({ stats, user }) {
  const [page, setPage] = useState(1)
  const perPage = 10
  const totalPages = Math.max(1, Math.ceil(stats.length / perPage))
  const currentPage = Math.min(page, totalPages)
  const paged = useMemo(() => {
    const start = (currentPage - 1) * perPage
    return stats.slice(start, start + perPage)
  }, [stats, currentPage])

  if (!stats.length) return null

  return (
    <>
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
            {paged.map((row) => {
              const isOwn =
                (row.email && row.email.toLowerCase() === String(user.email).toLowerCase()) ||
                row.name.trim().toLowerCase() === String(user.name).trim().toLowerCase()
              const display = shortName(row.name)
              const needsTitle = String(row.name || '').length > 11
              return (
                <tr key={row.employee} className={isOwn ? 'home-summary-own' : ''}>
                  <td className="home-employee-cell" title={row.email}>
                    <span title={needsTitle ? row.name : undefined}>{row.name}</span>
                    {!row.hasColumn && <span style={{ display: 'inline-block', fontSize: 10, color: '#e67e22', marginLeft: 10 }}>(no column found)</span>}
                    {/* {row.email && (
                      <span
                        title={row.email}
                        style={{ display: 'block', fontSize: 11, color: 'var(--text)', fontWeight: 400, cursor: 'default' }}
                      >
                        {row.email}
                      </span>
                    )} */}
                    {isOwn && <span className="home-you-badge">You</span>}

                  </td>
                  <td className="home-present">{row.present}</td>
                  <td className="home-absent">{row.absent}</td>
                  <td className="home-total">{row.total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="home-pagination">
          <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
            Prev
          </button>
          <span className="home-pagination-info">
            Page {currentPage} / {totalPages} · {stats.length} rows
          </span>
          <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
            Next
          </button>
          <div className="home-pagination-dots">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                className={`home-page-dot ${i + 1 === currentPage ? 'active' : ''}`}
                onClick={() => setPage(i + 1)}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
