import { hasGoogleCredentials, getAttendance, markAttendance } from './googleSheets'
import { getAttendanceInMemory, markAttendanceInMemory } from './memoryStore'

const useGoogle = hasGoogleCredentials()

if (!useGoogle) {
  console.warn(
    'No Google service account file found — attendance will be stored in memory ' +
      '(resets on restart). Add service-account.json to persist to Google Sheets.',
  )
}

export async function getAttendanceStatus(
  employeeName: string,
  employeeEmail?: string | number,
  day?: number | string,
): Promise<{ attended: boolean; status?: string }> {
  if (day === undefined) {
    const maybeDay = employeeEmail as unknown
    if (typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))) {
      day = maybeDay as number | string
      employeeEmail = undefined
    }
  }
  return useGoogle
    ? getAttendance(employeeName, employeeEmail as string | undefined, day as number)
    : getAttendanceInMemory(employeeName, employeeEmail as string | undefined, day as number)
}

export async function markAttendanceStatus(
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
  return useGoogle
    ? markAttendance(employeeName, employeeEmail as string | undefined, day as number, status as string)
    : markAttendanceInMemory(employeeName, employeeEmail as string | undefined, day as number, status as string)
}
