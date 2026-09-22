'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface HistoryDay {
  status: string
  time: string
}

interface HistoryPayload {
  year: number
  month: number
  monthLabel: string
  daysInMonth: number
  firstWeekday: number
  today: { year: number; month: number; day: number }
  tabExists: boolean
  hasColumn: boolean
  days: Record<string, HistoryDay>
  /** Day number -> holiday name, from the admin spreadsheet's Holiday List. */
  holidays: Record<string, string>
}

type DayKind = 'present' | 'absent' | 'off' | 'none'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? 'spin' : undefined}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}

/** Present = On-site/Remote, Absent = Absent…, everything else stays neutral. */
function kindOf(status: string): DayKind {
  const s = String(status || '').trim().toLowerCase()
  if (!s) return 'none'
  if (s.startsWith('absent')) return 'absent'
  if (s.startsWith('on-site') || s.startsWith('remote') || s.startsWith('present')) return 'present'
  if (s.startsWith('holiday') || s.startsWith('leave') || s === 'n/a' || s.startsWith('not available')) return 'off'
  return 'none'
}

function shiftMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

export default function AttendanceHistory() {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [data, setData] = useState<HistoryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Bumped by the refresh button to re-run the fetch below even when the month
  // is already cached.
  const [reloadKey, setReloadKey] = useState(0)
  const cache = useRef(new Map<string, HistoryPayload>())
  const router = useRouter()

  const close = useCallback(() => setOpen(false), [])

  // Re-read the sheet for every month (drops the cache) so the calendar shows
  // whatever is in the spreadsheet right now, and re-render the server
  // components behind the modal so the home summary table updates too.
  const refresh = useCallback(() => {
    cache.current.clear()
    setReloadKey((k) => k + 1)
    router.refresh()
  }, [router])

  useEffect(() => {
    if (!open) return
    const key = `${cursor.year}-${cursor.month}`
    const cached = cache.current.get(key)
    if (cached) {
      setData(cached)
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/attendance/history?year=${cursor.year}&month=${cursor.month}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.message || 'Could not load attendance history.')
        return body as HistoryPayload
      })
      .then((payload) => {
        if (cancelled) return
        cache.current.set(key, payload)
        setData(payload)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setData(null)
          setError(e.message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, cursor, reloadKey])

  // Close on Escape and keep the page behind the modal from scrolling.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, close])

  const cursorLabel = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month - 1, 1)),
    [cursor],
  )

  const active = data && data.year === cursor.year && data.month === cursor.month ? data : null

  const cells = useMemo(() => {
    if (!active) return []
    const out: (number | null)[] = []
    for (let i = 0; i < active.firstWeekday; i++) out.push(null)
    for (let d = 1; d <= active.daysInMonth; d++) out.push(d)
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [active])

  const isToday = (day: number) =>
    Boolean(active && active.today.year === active.year && active.today.month === active.month && active.today.day === day)

  // The sheet treats every Friday as a holiday, so unrecorded Fridays are
  // shown as holiday rather than as a plain empty day.
  const isFriday = (day: number) => (active ? new Date(active.year, active.month - 1, day).getDay() === 5 : false)

  return (
    <>
      <button
        type="button"
        className="history-btn"
        onClick={() => setOpen(true)}
        title="Attendance history"
        aria-label="Attendance history"
      >
        <HistoryIcon />
      </button>

      {open && (
        <div className="modal-overlay" onClick={close} role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Attendance history"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h4>Attendance history</h4>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-icon-btn modal-refresh"
                  onClick={refresh}
                  disabled={loading}
                  title="Refresh attendance and home summary"
                  aria-label="Refresh attendance and home summary"
                >
                  <RefreshIcon spinning={loading} />
                </button>
                <button
                  type="button"
                  className="modal-icon-btn modal-close"
                  onClick={close}
                  title="Close"
                  aria-label="Close history"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="cal-nav">
              <button
                type="button"
                className="cal-arrow"
                onClick={() => setCursor((c) => shiftMonth(c.year, c.month, -1))}
                aria-label="Previous month"
                title="Previous month"
              >
                <Chevron dir="left" />
              </button>
              <span className="cal-month">{active?.monthLabel || cursorLabel}</span>
              <button
                type="button"
                className="cal-arrow"
                onClick={() => setCursor((c) => shiftMonth(c.year, c.month, 1))}
                aria-label="Next month"
                title="Next month"
              >
                <Chevron dir="right" />
              </button>
            </div>

            <div className="cal-legend">
              <span>
                <i className="cal-dot present" /> Present
              </span>
              <span>
                <i className="cal-dot absent" /> Absent
              </span>
              <span>
                <i className="cal-dot off" /> Holiday / N/A
              </span>
            </div>

            <div className="cal-grid">
              {WEEKDAYS.map((w) => (
                <span key={w} className="cal-weekday">
                  {w}
                </span>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <span key={`blank-${i}`} className="cal-day empty" aria-hidden="true" />
                const entry = active?.days?.[String(day)]
                const holidayName = active?.holidays?.[String(day)]
                const friday = isFriday(day)
                const kind = entry ? kindOf(entry.status) : holidayName !== undefined || friday ? 'off' : 'none'
                const label = entry
                  ? `${entry.status}${entry.time ? ` · ${entry.time}` : ''}`
                  : holidayName !== undefined
                    ? `Holiday${holidayName ? ` · ${holidayName}` : ''}`
                    : friday
                      ? 'Holiday'
                      : 'No record'
                return (
                  <span
                    key={day}
                    className={`cal-day ${kind}${isToday(day) ? ' today' : ''}`}
                    title={`Day ${day} — ${label}`}
                  >
                    {day}
                  </span>
                )
              })}
            </div>

            {loading && <p className="cal-note">Loading…</p>}
            {!loading && error && <p className="cal-note error">{error}</p>}
            {!loading && !error && active && !active.tabExists && (
              <p className="cal-note">No attendance sheet exists for this month.</p>
            )}
            {!loading && !error && active && active.tabExists && !active.hasColumn && (
              <p className="cal-note">No attendance column found for your account in this month.</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
