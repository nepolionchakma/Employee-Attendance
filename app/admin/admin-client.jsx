'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

const STATUS_OPTIONS = ['', 'Office', 'Home', 'Absent']

function statusClass(s) {
  const v = String(s || '').trim()
  if (v === 'Office') return 'admin-cell-office'
  if (v === 'Home') return 'admin-cell-home'
  if (v === 'Absent') return 'admin-cell-absent'
  return 'admin-cell-empty'
}

function shortName(name) {
  const n = String(name || '')
  return n.length > 11 ? n.slice(0, 11) + '..' : n
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v7h-7" />
    </svg>
  )
}
function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  )
}
function DiscardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9 9 15M9 9l6 6" />
    </svg>
  )
}
function SheetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h8M8 9h1" />
    </svg>
  )
}

export default function AdminClient({ user }) {
  const [tab, setTab] = useState('')
  const [tabs, setTabs] = useState([])
  const [grid, setGrid] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  // pending edits: attendance -> { "emp::date": { employeeName, day, status } }
  const [pendingAttendance, setPendingAttendance] = useState({})
  // raw -> { "row::col": { row, col, value } }
  const [pendingRaw, setPendingRaw] = useState({})

  const pendingAttendanceCount = useMemo(() => Object.keys(pendingAttendance).length, [pendingAttendance])
  const pendingRawCount = useMemo(() => Object.keys(pendingRaw).length, [pendingRaw])
  const pendingCount = grid?.kind === 'attendance' ? pendingAttendanceCount : pendingRawCount

  const clearPending = useCallback(() => {
    setPendingAttendance({})
    setPendingRaw({})
  }, [])

  const fetchData = useCallback(async (tabName) => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const qs = tabName ? `?tab=${encodeURIComponent(tabName)}` : ''
      const res = await fetch(`/api/admin/data${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to load')
      setTabs(data.tabs || [])
      setGrid(data)
      if (!tabName) setTab(data.tab)
      clearPending()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [clearPending])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData('')
  }, [fetchData])

  const handleTabChange = (t) => {
    setTab(t)
    fetchData(t)
  }

  const handleAttendanceEdit = (employeeName, date, nextStatus) => {
    setSuccess('')
    setError('')
    setGrid((prev) => {
      if (!prev || prev.kind !== 'attendance') return prev
      const days = prev.days.map((d) =>
        d.date === date ? { ...d, values: { ...d.values, [employeeName]: nextStatus } } : d,
      )
      return { ...prev, days }
    })
    const key = `${employeeName}::${date}`
    setPendingAttendance((prev) => ({ ...prev, [key]: { employeeName, day: date, status: nextStatus } }))
  }

  const handleRawEdit = (row, col, value) => {
    setSuccess('')
    setError('')
    setGrid((prev) => {
      if (!prev || prev.kind !== 'raw') return prev
      const nextValues = prev.values.map((r) => [...(r || [])])
      while (nextValues.length <= row) nextValues.push([])
      while ((nextValues[row] || []).length <= col) nextValues[row].push('')
      nextValues[row][col] = value
      // ensure maxCols consistency for display, but keep as is
      return { ...prev, values: nextValues }
    })
    const key = `${row}::${col}`
    setPendingRaw((prev) => ({ ...prev, [key]: { row, col, value } }))
  }

  const handleSave = async () => {
    if (pendingCount === 0 || saving) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (grid?.kind === 'attendance') {
        const updates = Object.values(pendingAttendance)
        const res = await fetch('/api/admin/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab, attendanceUpdates: updates }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Save failed')
        setSuccess(`Saved ${updates.length} change${updates.length > 1 ? 's' : ''} to ${tab}`)
      } else if (grid?.kind === 'raw') {
        const updates = Object.values(pendingRaw)
        const res = await fetch('/api/admin/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab, rawUpdates: updates }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Save failed')
        setSuccess(`Saved ${updates.length} cell${updates.length > 1 ? 's' : ''} to ${tab}`)
      }
      clearPending()
      await fetchData(tab)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async () => {
    setError('')
    setSuccess('')
    clearPending()
    await fetchData(tab)
  }

  if (loading && !grid) {
    return (
      <div className="page admin-page">
        <p>Loading spreadsheet…</p>
      </div>
    )
  }

  const isAttendance = grid?.kind === 'attendance'
  const isRaw = grid?.kind === 'raw'

  return (
    <div className="page admin-page">
      <div className="admin-page-header">
        <h2>Manage Attendance</h2>
        <p className="admin-page-subtitle">View and edit any sheet — all changes stay local until you press Save.</p>
      </div>

      {error && <p className="attendance-status error">{error}</p>}
      {success && <p className="attendance-status success">{success}</p>}

      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <span className="admin-toolbar-label">
            <SheetIcon /> Sheet
          </span>
          <select
            id="tab"
            className="attendance-select admin-sheet-select"
            value={tab}
            onChange={(e) => handleTabChange(e.target.value)}
            disabled={saving}
          >
            {tabs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn btn-icon admin-refresh-btn" onClick={() => fetchData(tab)} disabled={loading || saving} title="Reload sheet">
            <RefreshIcon /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="admin-toolbar-right">
          {pendingCount > 0 && (
            <span className="admin-pending-badge" title={`${pendingCount} cell${pendingCount > 1 ? 's' : ''} edited`}>
              <span className="admin-pending-dot" /> {pendingCount} unsaved
            </span>
          )}
          <button
            className="btn btn-icon admin-discard-btn"
            onClick={handleDiscard}
            disabled={pendingCount === 0 || saving}
            title="Discard local edits"
          >
            <DiscardIcon /> Discard
          </button>
          <button
            className="btn primary btn-icon admin-save-btn"
            onClick={handleSave}
            disabled={pendingCount === 0 || saving}
          >
            <SaveIcon /> {saving ? 'Saving…' : `Save${pendingCount ? ` · ${pendingCount}` : ''}`}
          </button>
        </div>
      </div>

      {!grid ? (
        <p>No data.</p>
      ) : isAttendance ? (
        grid.employees.length === 0 ? (
          <p>No employee columns yet — employees appear after they sign in.</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    {grid.employees.map((emp) => {
                      const display = shortName(emp)
                      const needsTitle = String(emp || '').length > 11
                      return (
                        <th key={emp} title={needsTitle ? emp : undefined}>
                          {display}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {grid.days.map((row) => (
                    <tr key={row.date}>
                      <td className="admin-date">{row.date}</td>
                      <td className="admin-day">{row.day}</td>
                      {grid.employees.map((emp) => {
                        const val = row.values[emp] || ''
                        const key = `${emp}::${row.date}`
                        const isDirty = key in pendingAttendance
                        return (
                          <td key={emp} className={`${statusClass(val)}${isDirty ? ' admin-cell-dirty' : ''}`}>
                            <select
                              className="admin-cell-select"
                              value={val}
                              onChange={(e) => handleAttendanceEdit(emp, row.date, e.target.value)}
                              disabled={saving}
                              aria-label={`${emp} on ${row.date}`}
                            >
                              {STATUS_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt || '—'}
                                </option>
                              ))}
                            </select>
                            {isDirty && <span className="admin-dirty-dot" title="Unsaved" />}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="admin-summary-row">
                    <td>Absent Days</td>
                    <td />
                    {grid.employees.map((emp) => (
                      <td key={emp}>{grid.absentDays?.[emp] ?? 0}</td>
                    ))}
                  </tr>
                  <tr className="admin-summary-row admin-total-row">
                    <td>Total</td>
                    <td>{grid.total ?? 0}</td>
                    {grid.employees.map((emp) => (
                      <td key={emp} />
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
              Edit any cell, then press <strong>Save</strong> to write to Google Sheets. Absent Days recomputes on save.
            </p>
          </>
        )
      ) : isRaw ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
            Showing raw data for <strong>{grid.tab}</strong> — edit cells, then press <strong>Save</strong>.
          </p>
          {(() => {
            const values = grid.values || []
            if (values.length === 0)
              return (
                <div>
                  <p style={{ color: 'var(--text)' }}>This sheet is empty.</p>
                  <p style={{ fontSize: 13, color: 'var(--text)' }}>
                    Add data in Google Sheets, or click Save after adding via the sheet — use Sheets for new rows/columns.
                  </p>
                </div>
              )
            const maxCols = Math.max(0, ...values.map((r) => (r || []).length))
            return (
              <div className="admin-table-wrap">
                <table className="admin-table admin-raw-table">
                  <tbody>
                    {values.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {Array.from({ length: maxCols }).map((_, cIdx) => {
                          const cell = row?.[cIdx] ?? ''
                          const key = `${rIdx}::${cIdx}`
                          const isDirty = key in pendingRaw
                          const isHeader = rIdx === 0
                          return (
                            <td key={cIdx} className={`${isHeader ? 'admin-raw-header' : ''}${isDirty ? ' admin-cell-dirty' : ''}`}>
                              <input
                                className="admin-raw-input"
                                value={cell || ''}
                                onChange={(e) => handleRawEdit(rIdx, cIdx, e.target.value)}
                                disabled={saving}
                                aria-label={`Row ${rIdx + 1} Col ${cIdx + 1}`}
                              />
                              {isDirty && <span className="admin-dirty-dot" title="Unsaved" />}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
            Edits are local until you press Save. Press Discard to revert.
          </p>
        </>
      ) : (
        <p>Unknown sheet type.</p>
      )}
    </div>
  )
}
