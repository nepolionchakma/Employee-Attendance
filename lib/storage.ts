import { hasGoogleCredentials, getAttendance, markAttendance } from './googleSheets'
import { getAttendanceInMemory, markAttendanceInMemory } from './memoryStore'

function useGoogle(): boolean {
  const result = hasGoogleCredentials()
  return result
}

if (!useGoogle()) {
  console.warn(
    'No Google service account file found — attendance will be stored in memory ' +
      '(resets on restart). Add service-account.json to persist to Google Sheets.',
  )
}

export type AttendanceStatus = string

export interface AttendanceParams {
  employeeName: string
  employeeEmail?: string
  day?: number | string
}

export interface MarkAttendanceParams extends AttendanceParams {
  status?: AttendanceStatus
  time?: string
  location?: string
}

export type AttendanceResult = {
  attended: boolean
  status?: string
  time?: string
  location?: string
}

export async function getAttendanceStatus(params: AttendanceParams): Promise<AttendanceResult>
export async function getAttendanceStatus(
  employeeName: string,
  employeeEmail?: string,
  day?: number | string,
): Promise<AttendanceResult>
export async function getAttendanceStatus(
  employeeNameOrParams: string | AttendanceParams,
  employeeEmail?: string,
  day?: number | string,
): Promise<AttendanceResult> {
  let name: string
  let email: string | undefined
  let d: number | string | undefined

  if (typeof employeeNameOrParams === 'object' && employeeNameOrParams !== null) {
    name = employeeNameOrParams.employeeName
    email = employeeNameOrParams.employeeEmail
    d = employeeNameOrParams.day
  } else {
    name = employeeNameOrParams
    email = employeeEmail
    d = day
  }

  const dayNum = typeof d === 'number' ? d : typeof d === 'string' && /^\d+$/.test(d.trim()) ? Number(d) : undefined

  return useGoogle()
    ? getAttendance(name, email, dayNum)
    : getAttendanceInMemory(name, email, dayNum)
}

export async function markAttendanceStatus(params: MarkAttendanceParams): Promise<boolean>
export async function markAttendanceStatus(
  employeeName: string,
  employeeEmail?: string,
  day?: string | number,
  status?: string,
  time?: string,
  location?: string,
): Promise<boolean>
export async function markAttendanceStatus(
  employeeNameOrParams: string | MarkAttendanceParams,
  employeeEmail?: string,
  day?: string | number,
  status?: string,
  time?: string,
  location?: string,
): Promise<boolean> {
  let name: string
  let email: string | undefined
  let d: string | number | undefined
  let s: string | undefined
  let t: string | undefined
  let loc: string | undefined

  if (typeof employeeNameOrParams === 'object' && employeeNameOrParams !== null) {
    name = employeeNameOrParams.employeeName
    email = employeeNameOrParams.employeeEmail
    d = employeeNameOrParams.day
    s = employeeNameOrParams.status
    t = employeeNameOrParams.time
    loc = employeeNameOrParams.location
  } else {
    name = employeeNameOrParams
    email = employeeEmail
    d = day
    s = status
    t = time
    loc = location
  }

  const dayNum = typeof d === 'string' && /^\d+$/.test(d.trim()) ? Number(d) : typeof d === 'number' ? d : undefined

  return useGoogle()
    ? markAttendance(name, email, dayNum, s, t, loc)
    : markAttendanceInMemory(name, email, dayNum, s, t, loc)
}
