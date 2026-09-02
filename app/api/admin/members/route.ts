import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
  try {
    const { getEmployees, hasGoogleCredentials, ensureEmployeesSheet } = await import('@/lib/googleSheets')
    if (!hasGoogleCredentials()) return NextResponse.json({ members: [] })
    await ensureEmployeesSheet()
    const members = await getEmployees({ forceRefresh: true })
    return NextResponse.json({ members })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('GET /api/admin/members', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const role = String(body?.role || 'Employee').trim().toLowerCase()
  if (!email || !email.includes('@')) return NextResponse.json({ message: 'Valid email required' }, { status: 400 })
  if (!name) return NextResponse.json({ message: 'Name required' }, { status: 400 })
  try {
    const { addEmployee } = await import('@/lib/googleSheets')
    await addEmployee({ name, email, phone, role })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('POST /api/admin/members', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const index = Number(body?.index)
  const name = String(body?.name || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const role = String(body?.role || 'Employee').trim().toLowerCase()
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ message: 'Valid index required' }, { status: 400 })
  if (!email || !email.includes('@')) return NextResponse.json({ message: 'Valid email required' }, { status: 400 })
  try {
    const { updateEmployee } = await import('@/lib/googleSheets')
    await updateEmployee(index, { name, email, phone, role })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('PUT /api/admin/members', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ message: 'Not authenticated' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(request.url)
  const index = Number(searchParams.get('index'))
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ message: 'Valid index required' }, { status: 400 })
  try {
    const { deleteEmployee } = await import('@/lib/googleSheets')
    await deleteEmployee(index)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('DELETE /api/admin/members', msg)
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
