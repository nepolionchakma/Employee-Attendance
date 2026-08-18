// In-memory storage used when no Google service account file is present.
// Data resets when the server restarts.
const store = new Map() // key: `${employee}::${day}` -> status

export async function getAttendanceInMemory(employeeName, day) {
  const status = store.get(`${employeeName}::${day}`)
  return status ? { attended: true, status } : { attended: false }
}

export async function markAttendanceInMemory(employeeName, day, status) {
  store.set(`${employeeName}::${day}`, status)
  return true
}