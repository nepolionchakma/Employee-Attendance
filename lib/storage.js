import { hasGoogleCredentials, getAttendance, markAttendance } from './googleSheets'
import { getAttendanceInMemory, markAttendanceInMemory } from './memoryStore'

const useGoogle = hasGoogleCredentials()

if (!useGoogle) {
  console.warn(
    'No Google service account file found — attendance will be stored in memory ' +
      '(resets on restart). Add service-account.json to persist to Google Sheets.',
  )
}

export async function getAttendanceStatus(employeeName, day) {
  return useGoogle
    ? getAttendance(employeeName, day)
    : getAttendanceInMemory(employeeName, day)
}

export async function markAttendanceStatus(employeeName, day, status) {
  return useGoogle
    ? markAttendance(employeeName, day, status)
    : markAttendanceInMemory(employeeName, day, status)
}