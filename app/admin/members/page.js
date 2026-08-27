import { redirect } from 'next/navigation'

export default function MembersRedirect() {
  redirect('/manage-attendance/members')
}
