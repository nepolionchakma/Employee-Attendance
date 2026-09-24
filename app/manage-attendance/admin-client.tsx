'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { shortName } from '@/lib/utils'

const STATUS_OPTIONS = ['', 'On-site', 'Remote', 'Absent']

interface AttendanceGrid {
  kind: 'attendance'
  tab: string
  tabs: string[]
  employees: string[]
  days: { date: string; day: string; values: Record<string, string>; locationValues: Record<string, string> }[]
  absentDays: Record<string, number>
}

interface RawGrid {
  kind: 'raw'
  tab: string
  tabs: string[]
  values: string[][]
}

type GridData = AttendanceGrid | RawGrid | null

interface AdminClientUser {
  name: string
  email: string
  isAdmin: boolean
}

function statusClass(s: string) {
  const v = String(s || '').trim()
  if (v === 'On-site' || v.startsWith('On-site - ')) return 'admin-cell-onsite'
  if (v === 'Remote' || v.startsWith('Remote - ')) return 'admin-cell-remote'
  if (v === 'Absent' || v.startsWith('Absent - ')) return 'admin-cell-absent'
  if (v === 'Holiday') return 'admin-cell-onsite'
  return 'admin-cell-empty'
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

export default function AdminClient({ user }: { user: AdminClientUser }) {
  const [store, setStore] = useState('admin')
  const [stores, setStores] = useState<{ store: string; label: string; configured: boolean }[]>([
    { store: 'admin', label: 'Admin', configured: true },
    { store: 'employee', label: 'Employee', configured: true },
    { store: 'bootcamp', label: 'Bootcamp', configured: true },
  ])
  const [tab, setTab] = useState('')
  const [tabs, setTabs] = useState<string[]>([])
  const [grid, setGrid] = useState<GridData>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  // pending edits: attendance -> { "emp::date": { employeeName, day, status, location } }
  // `location` is only present once the editor actually touches that cell, so a
  // status-only edit can't overwrite the stored location.
  const [pendingAttendance, setPendingAttendance] = useState<Record<string, { employeeName: string; day: string; status: string; location?: string }>>({})
  // raw -> { "row::col": { row, col, value } }
  const [pendingRaw, setPendingRaw] = useState<Record<string, { row: number; col: number; value: string }>>({})

  const pendingAttendanceCount = useMemo(() => Object.keys(pendingAttendance).length, [pendingAttendance])
  const pendingRawCount = useMemo(() => Object.keys(pendingRaw).length, [pendingRaw])
  const pendingCount = grid?.kind === 'attendance' ? pendingAttendanceCount : pendingRawCount

  const clearPending = useCallback(() => {
    setPendingAttendance({})
    setPendingRaw({})
  }, [])

  const fetchData = useCallback(async (storeName: string, tabName: string) => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const qs = `?store=${encodeURIComponent(storeName)}${tabName ? `&tab=${encodeURIComponent(tabName)}` : ''}`
      const res = await fetch(`/api/admin/data${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to load')
      setTabs(data.tabs || [])
      if (Array.isArray(data.stores) && data.stores.length) setStores(data.stores)
      if (data.store) setStore(data.store)
      setGrid(data)
      if (!tabName) setTab(data.tab)
      clearPending()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clearPending])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData('admin', '')
  }, [fetchData])

  const handleStoreChange = (s: string) => {
    setStore(s)
    fetchData(s, '')
  }

  const handleTabChange = (t: string) => {
    setTab(t)
    fetchData(store, t)
  }

  const handleAttendanceEdit = (employeeName: string, date: string, field: string, value: string) => {
    setSuccess('')
    setError('')
    const row = grid?.kind === 'attendance' ? grid.days.find((d) => d.date === date) : undefined
    setGrid((prev) => {
      if (!prev || prev.kind !== 'attendance') return prev
      const days = prev.days.map((d) => {
        if (d.date !== date) return d
        if (field === 'status') return { ...d, values: { ...d.values, [employeeName]: value } }
        if (field === 'location') return { ...d, locationValues: { ...d.locationValues, [employeeName]: value } }
        return d
      })
      return { ...prev, days }
    })
    const key = `${employeeName}::${date}`
    setPendingAttendance((prev) => {
      const existing = prev[key] || {
        employeeName,
        day: date,
        status: row?.values?.[employeeName] || '',
      }
      // The time in the Presence cell is deduced server-side: unchanged status
      // keeps the recorded time, a new status is stamped with the current time
      // (Absent uses AUTO_ABSENT_TIME).
      return { ...prev, [key]: { ...existing, [field]: value } }
    })
  }

  const handleRawEdit = (row: number, col: number, value: string) => {
    setSuccess('')
    setError('')
    setGrid((prev) => {
      if (!prev || prev.kind !== 'raw') return prev
      const nextValues = prev.values.map((r) => [...(r || [])])
      while (nextValues.length <= row) nextValues.push([])
      while ((nextValues[row] || []).length <= col) nextValues[row]!.push('')
      nextValues[row]![col] = value
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
        const updates = Object.values(pendingAttendance).map((u) => ({
          employeeName: u.employeeName,
          day: u.day,
          status: u.status,
          location: u.location,
        }))
        // `location: undefined` is dropped by JSON.stringify — the server keeps
        // whatever the sheet already has (and defaults Absent days to N/A).
        const res = await fetch('/api/admin/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab, store, attendanceUpdates: updates }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Save failed')
        setSuccess(`Saved ${updates.length} change${updates.length > 1 ? 's' : ''} to ${store} / ${tab}`)
      } else if (grid?.kind === 'raw') {
        const updates = Object.values(pendingRaw)
        const res = await fetch('/api/admin/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab, store, rawUpdates: updates }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Save failed')
        setSuccess(`Saved ${updates.length} cell${updates.length > 1 ? 's' : ''} to ${store} / ${tab}`)
      }
      clearPending()
      await fetchData(store, tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async () => {
    setError('')
    setSuccess('')
    clearPending()
    await fetchData(store, tab)
  }

  const handlePrune = async () => {
    if (saving || loading) return
    const ok = window.confirm(
      `Move other groups' data out of ${store} / ${tab} into their correct sheets?\n\nForeign columns are COPIED to the right sheet first, then deleted here. Missing ${store} members will be added.`,
    )
    if (!ok) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, store, action: 'migrate', confirm: 'MIGRATE' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Migrate failed')
      const moved = Array.isArray(data.moved) ? data.moved.length : 0
      const conflicts = Array.isArray(data.conflicts) ? data.conflicts.length : 0
      setSuccess(`Migrated ${store} / ${tab}: moved ${moved} member(s), conflicts ${conflicts}, added ${data.addedCount ?? 0}`)
      if (conflicts > 0) {
        setSuccess(
          `Migrated ${store} / ${tab}: moved ${moved}, added ${data.addedCount ?? 0}, ${conflicts} conflict(s) kept live values — check console.`,
        )
        console.warn('Migrate conflicts:', data.conflicts)
      }
      clearPending()
      await fetchData(store, tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
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
        <h2>Manage Attendance{grid?.tab ? ` — ${grid.tab}` : ''}</h2>
        <p className="admin-page-subtitle">View and edit any sheet — all changes stay local until you press Save.</p>
      </div>

      {error && <p className="attendance-status error">{error}</p>}
      {success && <p className="attendance-status success">{success}</p>}

      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <span className="admin-toolbar-label">
            <SheetIcon /> Spreadsheet
          </span>
          <select
            id="store"
            className="attendance-select admin-sheet-select"
            value={store}
            onChange={(e) => handleStoreChange(e.target.value)}
            disabled={saving || loading}
            aria-label="Spreadsheet"
          >
            {stores.map((s) => (
              <option key={s.store} value={s.store}>
                {s.label}{s.configured ? '' : ' (not configured)'}
              </option>
            ))}
          </select>
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
          <button className="btn btn-icon admin-refresh-btn" onClick={() => fetchData(store, tab)} disabled={loading || saving} title="Reload sheet">
            <RefreshIcon /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="btn btn-icon admin-discard-btn"
            onClick={handlePrune}
            disabled={loading || saving || !tab}
            title="Delete other groups' columns from this tab and add missing members of this group"
          >
            <DiscardIcon /> Prune
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
              <table className="admin-table admin-attendance-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Date</th>
                    <th rowSpan={2}>Day</th>
                    {grid.employees.map((emp) => {
                      const display = shortName(emp)
                      const needsTitle = String(emp || '').length > 11
                      return (
                        <th key={emp} colSpan={2} className="admin-emp-header" title={needsTitle ? emp : undefined}>
                          {display}
                        </th>
                      )
                    })}
                  </tr>
                  <tr>
                    {grid.employees.map((emp) => (
                      <React.Fragment key={emp}>
                        <th className="admin-sub-header">Presence</th>
                        <th className="admin-sub-header">Location</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.days.map((row) => (
                    <tr key={row.date} className={row.day === 'Fri' ? 'admin-row-friday' : ''}>
                      <td className="admin-date">{row.date}</td>
                      <td className="admin-day">{row.day}</td>
                      {grid.employees.map((emp) => {
                        const key = `${emp}::${row.date}`
                        const isDirty = key in pendingAttendance
                        const displayStatus = isDirty ? (pendingAttendance[key]?.status ?? (row.values[emp] || '')) : row.values[emp] || ''
                        const displayLocation = isDirty
                          ? (pendingAttendance[key]?.location ?? (row.locationValues?.[emp] || ''))
                          : row.locationValues?.[emp] || ''

                        return (
                          <React.Fragment key={emp}>
                            <td className={`${statusClass(displayStatus)}${isDirty ? ' admin-cell-dirty' : ''}`}>
                              <select
                                className="admin-cell-select"
                                value={displayStatus}
                                onChange={(e) => handleAttendanceEdit(emp, row.date, 'status', e.target.value)}
                                disabled={saving}
                                aria-label={`${emp} presence on ${row.date}`}
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt || '—'}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={isDirty ? ' admin-cell-dirty' : ''}>
                              <input
                                className="admin-loc-input"
                                type="text"
                                value={displayLocation}
                                placeholder="road, district"
                                onChange={(e) => handleAttendanceEdit(emp, row.date, 'location', e.target.value)}
                                disabled={saving}
                                aria-label={`${emp} location on ${row.date}`}
                              />
                              {isDirty && <span className="admin-dirty-dot" title="Unsaved" />}
                            </td>
                          </React.Fragment>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="admin-summary-row">
                    <td colSpan={2}>Absent Days</td>
                    {grid.employees.map((emp) => (
                      <td key={emp} colSpan={2}>{grid.absentDays?.[emp] ?? 0}</td>
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
            const headerRow = values[0] || []
            const dataRows = values.slice(1)
            return (
              <div className="admin-table-wrap">
                <table className="admin-table admin-raw-table">
                  <thead>
                    <tr>
                      <th className="admin-raw-row-num">#</th>
                      {Array.from({ length: maxCols }).map((_, cIdx) => (
                        <th key={cIdx} className="admin-raw-header">
                          {headerRow[cIdx] || String.fromCharCode(65 + cIdx)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="admin-raw-row-num">{rIdx + 1}</td>
                        {Array.from({ length: maxCols }).map((_, cIdx) => {
                          const cell = row?.[cIdx] ?? ''
                          const key = `${rIdx + 1}::${cIdx}`
                          const isDirty = key in pendingRaw
                          return (
                            <td key={cIdx} className={isDirty ? 'admin-cell-dirty' : ''}>
                              <input
                                className="admin-raw-input"
                                value={cell || ''}
                                onChange={(e) => handleRawEdit(rIdx + 1, cIdx, e.target.value)}
                                disabled={saving}
                                aria-label={`Row ${rIdx + 2} Col ${cIdx + 1}`}
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
            Edit any cell, then press <strong>Save</strong> to write to Google Sheets.
          </p>
        </>
      ) : (
        <p>Unknown sheet type.</p>
      )}
    </div>
  )
}
