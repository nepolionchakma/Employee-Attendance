import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import Navbar from '@/app/components/Navbar'
import MembersClient from './members-client'

export const metadata = { title: 'Members — Admin' }

export default async function MembersPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!user.isAdmin) redirect('/')

  return (
    <>
      <Navbar user={user} />
      <MembersClient />
    </>
  )
}
