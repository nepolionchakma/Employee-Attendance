import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AdminClient from './admin-client'
import Navbar from '@/app/components/Navbar'

export const metadata = { title: 'Admin — Attendance' }

export default async function AdminPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!user.isAdmin) redirect('/')

  return (
    <>
      <Navbar user={user} />
      <AdminClient user={user} />
    </>
  )
}
