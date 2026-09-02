// In-memory storage used when no Google service account file is present.
// Data resets when the server restarts. Gmail is primary key (per Gmail).
const store = new Map<string, string>() // key: `${email||name}::${day}` -> `status\x00time\x00location` (null-byte delimited to avoid collisions with user data)

export async function getAttendanceInMemory(
  employeeName: string,
  employeeEmail?: string | number,
  day?: number | string,
): Promise<{ attended: boolean; status?: string; time?: string; location?: string }> {
  if (day === undefined) {
    const maybeDay = employeeEmail as unknown
    if (typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))) {
      day = maybeDay as number
      employeeEmail = undefined
    }
  }
  const key = `${String(employeeEmail || employeeName).toLowerCase()}::${day}`
  const raw = store.get(key)
  if (!raw) return { attended: false }
  const [status, time, location] = raw.split('\x00')
  return { attended: true, status, time, location }
}

export async function markAttendanceInMemory(
  employeeName: string,
  employeeEmail?: string | number,
  day?: string | number,
  status?: string,
  time?: string,
  location?: string,
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
  const t = String(time || '').trim() || new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  const loc = String(location || '').trim() || 'N/A'
  store.set(key, `${status}\x00${t}\x00${loc}`)
  return true
}
