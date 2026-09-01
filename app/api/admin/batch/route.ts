import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const tab = String(body?.tab || '').trim()

  try {
    const { hasGoogleCredentials, batchUpdateRawCells, batchUpdateAttendanceCells } =
      await import('@/lib/googleSheets')
    if (!hasGoogleCredentials()) {
      return NextResponse.json({ message: 'Google Sheets not configured' }, { status: 500 })
    }

    // Generic raw batch: { rawUpdates: [{row, col, value}] }
    if (Array.isArray(body?.rawUpdates) && body.rawUpdates.length) {
      const cells = body.rawUpdates.map((u: { row: unknown; col: unknown; value: unknown }) => ({
        row: Number(u.row),
        col: Number(u.col),
        value: String(u.value ?? ''),
      }))
      if (cells.some((c: { row: number; col: number }) => !Number.isInteger(c.row) || !Number.isInteger(c.col) || c.row < 0 || c.col < 0)) {
        return NextResponse.json({ message: 'rawUpdates row/col must be non-negative integers' }, { status: 400 })
      }
      await batchUpdateRawCells(tab, cells)
      return NextResponse.json({ ok: true, updated: cells.length })
    }

    // Attendance batch: { attendanceUpdates: [{employeeName, day, status}] }
    if (Array.isArray(body?.attendanceUpdates) && body.attendanceUpdates.length) {
      const updates = body.attendanceUpdates.map((u: { employeeName?: string; day?: string; status?: string }) => ({
        employeeName: String(u.employeeName || '').trim(),
        day: String(u.day || '').trim(),
        status: String(u.status ?? '').trim(),
      }))
      if (updates.some((u: { employeeName: string; day: string }) => !u.employeeName || !u.day)) {
        return NextResponse.json({ message: 'each attendanceUpdate needs employeeName and day' }, { status: 400 })
      }
      await batchUpdateAttendanceCells(tab, updates)
      return NextResponse.json({ ok: true, updated: updates.length })
    }

    return NextResponse.json({ message: 'Provide rawUpdates or attendanceUpdates' }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('POST /api/admin/batch failed:', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
