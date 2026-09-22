'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { shortName } from '@/lib/utils'

interface AttendanceFormProps {
  employeeName: string
  employeeEmail: string
  /** Member role from the Members tab of the admin sheet (Admin / Employee / Bootcamp). */
  role?: string
}

interface CheckState {
  kind: 'already' | 'ready' | 'success' | 'error' | 'holiday'
  message: string
}

export default function AttendanceForm({ employeeName, employeeEmail, role }: AttendanceFormProps) {
  const [status, setStatus] = useState('On-site')
  const [check, setCheck] = useState<CheckState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!employeeName && !employeeEmail) return
    let cancelled = false

    const qs = employeeEmail
      ? `email=${encodeURIComponent(employeeEmail)}`
      : `employee=${encodeURIComponent(employeeName)}`
    fetch(`/api/attendance/status?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setCheck(
          data?.holiday
            ? { kind: 'holiday', message: data.message || 'Today is a holiday — attendance is not needed.' }
            : data?.attended
              ? {
                kind: 'already',
                message: `${employeeName} ${data.status === 'Holiday' ? `- today is marked as a ${data.status}.` : `already attended today (${data.status})`} `,
              }
              : { kind: 'ready', message: 'Not marked yet — you can submit.' },
        )
      })
      .catch(() => {
        if (!cancelled) setCheck({ kind: 'error', message: 'Could not check attendance status.' })
      })
    return () => {
      cancelled = true
    }
  }, [employeeName, employeeEmail])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!employeeName && !employeeEmail) || submitting) return

    setSubmitting(true)
    try {
      const time = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Dhaka',
      }).format(new Date())

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeName, employeeEmail, status, time }),
      })
      const data = await res.json()

      if (data?.holiday) {
        setCheck({ kind: 'holiday', message: data.message })
      } else if (res.status === 409) {
        setCheck({ kind: 'already', message: data.message })
      } else if (res.ok) {
        setCheck({ kind: 'success', message: data.message })
        router.refresh()
      } else {
        setCheck({ kind: 'error', message: data.message })
      }
    } catch {
      setCheck({ kind: 'error', message: 'Could not reach the attendance server.' })
    } finally {
      setSubmitting(false)
    }
  }

  const statusOptions = ['On-site', 'Remote']

  // Locked once attendance is recorded — either detected on load (already)
  // or right after a successful submit (success) — until the page is reloaded.
  // Holidays lock it too: nothing is expected to be marked that day.
  const attended = check?.kind === 'already' || check?.kind === 'success' || check?.kind === 'holiday'
  const onHoliday = check?.kind === 'holiday'

  return (
    <div className="page">
      <h2>Attendance</h2>
      <p>Mark today&apos;s attendance.</p>

      <div className="card">
        <form onSubmit={handleSubmit} className="attendance-form">
          <label htmlFor="employee">{role || 'Employee'}</label>
          <p id="employee" className="attendance-employee" title={String(employeeName || '').length > 11 ? employeeName : undefined}>
            {employeeName}
            {employeeEmail && <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--text)', marginTop: 2 }}>{employeeEmail}</span>}
          </p>

          <fieldset className="attendance-radio">
            <legend>Working from</legend>
            {statusOptions.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="status"
                  value={option}
                  checked={status === option}
                  onChange={() => setStatus(option)}
                  disabled={attended}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            className="btn primary"
            disabled={(!employeeName && !employeeEmail) || submitting || attended}
          >
            {submitting
              ? 'Submitting…'
              : onHoliday
                ? 'Holiday — submission disabled'
                : attended
                  ? 'Attendance submitted'
                  : 'Submit attendance'}
          </button>
        </form>

        {check && <p className={`attendance-status ${check.kind}`}>{check.message}</p>}
      </div>
    </div>
  )
}
