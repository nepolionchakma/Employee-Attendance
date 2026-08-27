// In-memory storage used when no Google service account file is present.
// Data resets when the server restarts. Gmail is primary key (per Gmail).
const store = new Map() // key: `${email||name}::${day}` -> status

export async function getAttendanceInMemory(employeeName, employeeEmail, day) {
  if (day === undefined) {
    const maybeDay = employeeEmail
    if (typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))) {
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const key = `${String(employeeEmail || employeeName).toLowerCase()}::${day}`
  const status = store.get(key)
  return status ? { attended: true, status } : { attended: false }
}

export async function markAttendanceInMemory(employeeName, employeeEmail, day, status) {
  if (status === undefined) {
    const maybeDay = employeeEmail
    const maybeStatus = day
    const isDay = typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    const isStatus = typeof maybeStatus === 'string' && ['', 'Office', 'Home', 'Absent'].includes(String(maybeStatus).trim())
    if (isDay && isStatus) {
      status = maybeStatus
      day = maybeDay
      employeeEmail = undefined
    }
  }
  const key = `${String(employeeEmail || employeeName).toLowerCase()}::${day}`
  store.set(key, status)
  return true
}