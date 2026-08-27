// @ts-nocheck
'use client'

import { useEffect, useState } from 'react'

function shortName(name) {
  const n = String(name || '')
  return n.length > 11 ? n.slice(0, 11) + '..' : n
}

export default function AttendanceForm({ employeeName, employeeEmail }) {
  const [status, setStatus] = useState('Office')
  const [check, setCheck] = useState(null)
  const [submitting, setSubmitting] = useState(false)

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
          data?.attended
            ? {
                kind: 'already',
                message: `${employeeName} already attended today (${data.status})`,
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if ((!employeeName && !employeeEmail) || submitting) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeName, employeeEmail, status }),
      })
      const data = await res.json()

      if (res.status === 409) {
        setCheck({ kind: 'already', message: data.message })
      } else if (res.ok) {
        setCheck({ kind: 'success', message: data.message })
      } else {
        setCheck({ kind: 'error', message: data.message })
      }
    } catch {
      setCheck({ kind: 'error', message: 'Could not reach the attendance server.' })
    } finally {
      setSubmitting(false)
    }
  }

  const statusOptions = ['Office', 'Home']

  return (
    <div className="page">
      <h2>Attendance</h2>
      <p>Mark today&apos;s attendance.</p>

      <div className="card">
        <form onSubmit={handleSubmit} className="attendance-form">
          <label htmlFor="employee">Employee</label>
          <p id="employee" className="attendance-employee" title={String(employeeName || '').length > 11 ? employeeName : undefined}>
            {shortName(employeeName)}
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
                  disabled={check?.kind === 'already'}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            className="btn primary"
            disabled={(!employeeName && !employeeEmail) || submitting}
          >
            {submitting ? 'Submitting…' : 'Submit attendance'}
          </button>
        </form>

        {check && <p className={`attendance-status ${check.kind}`}>{check.message}</p>}
      </div>
    </div>
  )
}