'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { shortName } from '@/lib/utils'

const STATUS_OPTIONS = ['', 'Office', 'Home', 'Absent']

function formatSystemTime() {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  }).format(new Date())
}

function previewTime(status: string) {
  if (status === 'Absent') return '12:00 AM'
  if (status === 'Office' || status === 'Home') return formatSystemTime()
  return ''
}

function getRealTimeLocation(): Promise<string> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve('N/A')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          )
          const data = await res.json()
          const addr = data.address || {}
          const road = addr.road || addr.county || ''
          const district = addr.state_district || ''
          resolve([road, district].filter(Boolean).join(', ') || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
        } catch {
          resolve('N/A')
        }
      },
      () => resolve('N/A'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })
}

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
  if (v === 'Office' || v.startsWith('Office - ')) return 'admin-cell-office'
  if (v === 'Home' || v.startsWith('Home - ')) return 'admin-cell-home'
  if (v === 'Absent' || v.startsWith('Absent - ')) return 'admin-cell-absent'
  if (v === 'Holiday') return 'admin-cell-office'
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
  const [tab, setTab] = useState('')
  const [tabs, setTabs] = useState<string[]>([])
  const [grid, setGrid] = useState<GridData>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  // pending edits: attendance -> { "emp::date": { employeeName, day, status, location, time } }
  const [pendingAttendance, setPendingAttendance] = useState<Record<string, { employeeName: string; day: string; status: string; location?: string; time?: string }>>({})
  // raw -> { "row::col": { row, col, value } }
  const [pendingRaw, setPendingRaw] = useState<Record<string, { row: number; col: number; value: string }>>({})

  const pendingAttendanceCount = useMemo(() => Object.keys(pendingAttendance).length, [pendingAttendance])
  const pendingRawCount = useMemo(() => Object.keys(pendingRaw).length, [pendingRaw])
  const pendingCount = grid?.kind === 'attendance' ? pendingAttendanceCount : pendingRawCount

  const clearPending = useCallback(() => {
    setPendingAttendance({})
    setPendingRaw({})
  }, [])

  const fetchData = useCallback(async (tabName: string) => {
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clearPending])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData('')
  }, [fetchData])

  const handleTabChange = (t: string) => {
    setTab(t)
    fetchData(t)
  }

  const handleAttendanceEdit = (employeeName: string, date: string, field: string, value: string) => {
    setSuccess('')
    setError('')
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
      const existing = prev[key] || { employeeName, day: date, status: '', location: '', time: '' }
      if (field === 'status') {
        // Auto-fill time when status changes: system time for Office/Home, 12:00 AM for Absent
        const autoTime = value === 'Absent' ? '12:00 AM' : value ? formatSystemTime() : ''
        return { ...prev, [key]: { ...existing, status: value, time: autoTime } }
      }
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
          time: u.time || '',
          location: u.location || '',
        }))
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
      setError(e instanceof Error ? e.message : String(e))
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
        <h2>Manage Attendance{grid?.tab ? ` — ${grid.tab}` : ''}</h2>
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
                        const val = row.values[emp] || ''
                        const origLocVal = row.locationValues?.[emp] || ''
                        const key = `${emp}::${row.date}`
                        const isDirty = key in pendingAttendance
                        // Extract status from merged 'Status - Time' format
                        const dashIdx = val.lastIndexOf(' - ')
                        const statusVal = dashIdx !== -1 ? val.substring(0, dashIdx).trim() : val
                        // Extract time from merged 'Status - Time' format
                        const origTime = dashIdx !== -1 ? val.substring(dashIdx + 3).trim() : ''
                        const displayStatus = isDirty ? (pendingAttendance[key]?.status ?? statusVal) : statusVal
                        const currentTime = isDirty ? (pendingAttendance[key]?.time ?? '') : origTime
                        const displayLoc = isDirty ? (pendingAttendance[key]?.location ?? origLocVal) : origLocVal

                        return (
                          <React.Fragment key={emp}>
                            <td className={`${statusClass(displayStatus)}${isDirty ? ' admin-cell-dirty' : ''}`}>
                              <select
                                className="admin-cell-select"
                                value={displayStatus}
                                onChange={async (e) => {
                                  const newStatus = e.target.value
                                  handleAttendanceEdit(emp, row.date, 'status', newStatus)
                                  // Fetch real-time GPS location for Office/Home
                                  if (newStatus === 'Office' || newStatus === 'Home') {
                                    const loc = await getRealTimeLocation()
                                    handleAttendanceEdit(emp, row.date, 'location', loc)
                                  } else if (newStatus === 'Absent') {
                                    handleAttendanceEdit(emp, row.date, 'location', 'N/A')
                                  } else {
                                    handleAttendanceEdit(emp, row.date, 'location', '')
                                  }
                                }}
                                disabled={saving}
                                aria-label={`${emp} presence on ${row.date}`}
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt || '—'}
                                  </option>
                                ))}
                              </select>
                              {displayStatus && (
                                <input
                                  className="admin-time-input"
                                  type="text"
                                  value={currentTime}
                                  placeholder="time"
                                  onChange={(e) => handleAttendanceEdit(emp, row.date, 'time', e.target.value)}
                                  disabled={saving}
                                  aria-label={`${emp} time on ${row.date}`}
                                />
                              )}
                            </td>
                            <td className={isDirty ? ' admin-cell-dirty' : ''}>
                              <input
                                className="admin-loc-input"
                                value={displayLoc}
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
