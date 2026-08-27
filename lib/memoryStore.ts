// In-memory storage used when no Google service account file is present.
// Data resets when the server restarts. Gmail is primary key (per Gmail).
const store = new Map<string, string>() // key: `${email||name}::${day}` -> status

export async function getAttendanceInMemory(
  employeeName: string,
  employeeEmail?: string | number,
  day?: number | string,
): Promise<{ attended: boolean; status?: string }> {
  if (day === undefined) {
    const maybeDay = employeeEmail as unknown
    if (typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))) {
      day = maybeDay as number
      employeeEmail = undefined
    }
  }
  const key = `${String(employeeEmail || employeeName).toLowerCase()}::${day}`
  const status = store.get(key)
  return status ? { attended: true, status } : { attended: false }
}

export async function markAttendanceInMemory(
  employeeName: string,
  employeeEmail?: string | number,
  day?: string | number,
  status?: string,
): Promise<boolean> {
  if (status === undefined) {
    const maybeDay = employeeEmail as unknown
    const maybeStatus = day as unknown
    const isDay =
      typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))
    const isStatus =
      typeof maybeStatus === 'string' && ['', 'Office', 'Home', 'Absent'].includes(String(maybeStatus).trim())
    if (isDay && isStatus) {
      status = maybeStatus as string
      day = maybeDay as number
      employeeEmail = undefined
    }
  }
  const key = `${String(employeeEmail || employeeName).toLowerCase()}::${day}`
  store.set(key, String(status ?? ''))
  return true
}
