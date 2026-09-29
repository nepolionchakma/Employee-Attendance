import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Live Sheets quota estimate for the navbar counter. Per-server-process
// lower bound (see getSheetsUsage) — the real shared quota can be higher
// with multiple instances.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })

  const { getSheetsUsage } = await import('@/lib/googleSheets')
  return NextResponse.json(getSheetsUsage())
}
