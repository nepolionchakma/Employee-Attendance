import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AttendanceForm from './attendance-form'

export const metadata = { title: 'Attendance' }

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="page">
      <div className="topbar">
        <p className="user-name">Signed in as {user.name}</p>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="btn">
            Logout
          </button>
        </form>
      </div>
      <AttendanceForm employeeName={user.name} />
    </div>
  )
}