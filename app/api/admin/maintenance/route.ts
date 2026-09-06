import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * Admin-only sheet maintenance:
 *  - action=refresh  — re-run auto-absent fill + Absent Days summary on a tab
 *  - action=add-col  — add a 2-col Presence/Time block for one employee
 *  - action=rebuild  — delete + re-create the tab in the canonical structure
 *                      (repairs legacy/mixed structure; past days auto-filled)
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const tab = String(body?.tab || '').trim()
  const action = String(body?.action || '').trim()

  try {
    const { hasGoogleCredentials, recreateAttendanceTab, addEmployeeColumnToTab, refreshAttendanceTab, getEmployees } =
      await import('@/lib/googleSheets')
    if (!hasGoogleCredentials()) {
      return NextResponse.json({ message: 'Google Sheets not configured' }, { status: 500 })
    }

    if (action === 'rebuild') {
      if (!tab) return NextResponse.json({ message: 'tab is required for rebuild' }, { status: 400 })
      if (!confirmRebuild(body?.confirm)) {
        return NextResponse.json(
          { message: 'Set confirm:"REBUILD" to acknowledge the tab will be deleted and re-created.' },
          { status: 400 },
        )
      }
      const directory = await getEmployees({ forceRefresh: true })
      const result = await recreateAttendanceTab(tab, directory.map((m) => ({ name: m.name, email: m.email })))
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'add-col') {
      const name = String(body?.employeeName || '').trim()
      const email = String(body?.employeeEmail || '').trim()
      if (!email) return NextResponse.json({ message: 'employeeEmail is required' }, { status: 400 })
      await addEmployeeColumnToTab(tab, name, email)
      return NextResponse.json({ ok: true })
    }

    if (action === 'refresh' || !action) {
      const result = await refreshAttendanceTab(tab || undefined)
      return NextResponse.json({ ok: true, ...result })
    }

    return NextResponse.json({ message: 'Unknown action. Use refresh | add-col | rebuild.' }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('POST /api/admin/maintenance failed:', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

function confirmRebuild(v: unknown): boolean {
  return String(v || '').trim().toUpperCase() === 'REBUILD'
}
