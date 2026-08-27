import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

  const tab = request.nextUrl.searchParams.get('tab') || ''
  try {
    const { hasGoogleCredentials, getAdminGrid, getRawSheet, listMonthTabs } = await import('@/lib/googleSheets')
    if (!hasGoogleCredentials()) {
      return NextResponse.json({ message: 'Google Sheets not configured' }, { status: 500 })
    }
    const tabs = await listMonthTabs()
    // Try attendance-structured grid first; if the sheet isn't attendance-shaped,
    // fall back to raw 2D values (dynamic view for any sheet).
    try {
      const grid = await getAdminGrid(tab)
      return NextResponse.json({ tabs, kind: 'attendance', ...grid })
    } catch (e) {
      const msg = String(e?.message || '')
      const isStructureError =
        msg.includes('No header row with "Date"') || msg.includes('not found in the sheet headers')
      if (!isStructureError) throw e
      const raw = await getRawSheet(tab)
      return NextResponse.json({ tabs, kind: 'raw', tab: raw.tab, values: raw.values })
    }
  } catch (error) {
    console.error('GET /api/admin/data failed:', error.message)
    return NextResponse.json({ message: error.message }, { status: 500 })
  }
}
