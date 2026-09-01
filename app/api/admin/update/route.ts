import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const tab = String(body?.tab || '').trim()

  // Generic raw cell edit (dynamic sheets): { row, col, value }
  const hasRawCoords = body?.row !== undefined && body?.col !== undefined

  try {
    const { hasGoogleCredentials, adminUpdateCell, updateRawCell } = await import('@/lib/googleSheets')
    if (!hasGoogleCredentials()) {
      return NextResponse.json({ message: 'Google Sheets not configured' }, { status: 500 })
    }

    if (hasRawCoords) {
      const row = Number(body.row)
      const col = Number(body.col)
      const value = String(body?.value ?? '')
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
        return NextResponse.json({ message: 'row and col must be non-negative integers' }, { status: 400 })
      }
      await updateRawCell(tab, row, col, value)
      return NextResponse.json({ ok: true })
    }

    const employeeName = String(body?.employeeName || '').trim()
    const employeeEmail = String(body?.employeeEmail || '').trim()
    const day = String(body?.day || '').trim()
    const status = String(body?.status ?? '').trim()

    if (!employeeName || !day) {
      return NextResponse.json({ message: 'employeeName and day are required' }, { status: 400 })
    }
    await adminUpdateCell(tab, employeeName, day, status, employeeEmail || undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('POST /api/admin/update failed:', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
