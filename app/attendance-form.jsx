'use client'

import { useEffect, useState } from 'react'

export default function AttendanceForm({ employeeName }) {
  const [status, setStatus] = useState('Office')
  const [check, setCheck] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!employeeName) return
    let cancelled = false

    fetch(`/api/attendance/status?employee=${encodeURIComponent(employeeName)}`)
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
  }, [employeeName])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!employeeName || submitting) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeName, status }),
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
          <p id="employee" className="attendance-employee">
            {employeeName}
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
            disabled={!employeeName || submitting}
          >
            {submitting ? 'Submitting…' : 'Submit attendance'}
          </button>
        </form>

        {check && <p className={`attendance-status ${check.kind}`}>{check.message}</p>}
      </div>
    </div>
  )
}