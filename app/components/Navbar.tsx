'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { shortName } from '@/lib/utils'

interface NavbarUser {
  name: string
  email: string
  isAdmin: boolean
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 9L12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  )
}
function ManageAttendance() {
  return (
    <svg width="16" height="16" viewBox="0 0 60 65" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M44 51v9a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11" />
      <path d="M31 7h11a2 2 0 0 1 2 2v30" />
      <path d="M29 56H7a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2h6" />
      <path d="M31 12h6a2 2 0 0 1 2 2v30" />
      <path d="M29 5c0 0-3-.7-3-1a4 4 0 0 0-8 0c0 .3-3 1-3 1a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
      <line x1="10" y1="22" x2="31" y2="22" />
      <line x1="10" y1="28" x2="22" y2="28" />
      <line x1="10" y1="33" x2="33" y2="33" />
      <line x1="10" y1="40" x2="27" y2="40" />
      <line x1="23" y1="48" x2="33" y2="48" />
      <path d="M36 58.5l-9 3.5 3.5-9 20.3-20.3a1.13 1.13 0 0 1 1.6 0l3.9 3.9a1.13 1.13 0 0 1 0 1.6z" />
      <line x1="48.9" y1="34.7" x2="54.3" y2="40.1" />
    </svg>

  )
}

function ManageMembers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M20 8v6M23 11v2M17 11v2" />
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function Navbar({ user }: { user: NavbarUser }) {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const isAdminPage = pathname?.startsWith('/manage-attendance') || pathname?.startsWith('/admin')

  if (!user) return null

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-brand">
          <span className="navbar-brand-icon">◉</span> Attendance
        </Link>

        <div className="navbar-links">
          {user.isAdmin && (
            <>
              <Link href="/" className={`navbar-link ${isHome ? 'active' : ''}`}>
                <HomeIcon />
                <span className="navbar-link-label">Home</span>
              </Link>
              <Link href="/manage-attendance" className={`navbar-link ${pathname === '/manage-attendance' ? 'active' : ''}`}>
                <ManageAttendance />
                <span className="navbar-link-label">Manage Attendance</span>
              </Link>
              <Link href="/manage-members" className={`navbar-link ${pathname === '/manage-members' ? 'active' : ''}`}>
                <ManageMembers />
                <span className="navbar-link-label">Manage Members</span>
              </Link>
            </>
          )}
        </div>

        <div className="navbar-user-name">
          <span className="navbar-user" title={String(user.name || '').length > 11 ? user.name : user.email}>
            {user.name}
            {user.isAdmin && <span className="navbar-admin-badge">Admin</span>}
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn btn-icon navbar-logout" data-label="Logout">
              <LogoutIcon />
              <span className="navbar-link-label">Logout</span>
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
