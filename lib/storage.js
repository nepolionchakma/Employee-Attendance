import { hasGoogleCredentials, getAttendance, markAttendance } from './googleSheets'
import { getAttendanceInMemory, markAttendanceInMemory } from './memoryStore'

const useGoogle = hasGoogleCredentials()

if (!useGoogle) {
  console.warn(
    'No Google service account file found — attendance will be stored in memory ' +
      '(resets on restart). Add service-account.json to persist to Google Sheets.',
  )
}

export async function getAttendanceStatus(employeeName, employeeEmail, day) {
  if (day === undefined) {
    const maybeDay = employeeEmail
    if (typeof maybeDay === 'number' || (typeof maybeDay === 'string' && /^\d+$/.test(String(maybeDay).trim()))) {
      day = maybeDay
      employeeEmail = undefined
    }
  }
  return useGoogle
    ? getAttendance(employeeName, employeeEmail, day)
    : getAttendanceInMemory(employeeName, employeeEmail, day)
}

export async function markAttendanceStatus(employeeName, employeeEmail, day, status) {
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
  return useGoogle
    ? markAttendance(employeeName, employeeEmail, day, status)
    : markAttendanceInMemory(employeeName, employeeEmail, day, status)
}