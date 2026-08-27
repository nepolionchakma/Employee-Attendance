'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 9L12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  )
}
function ManageIcon() {
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

export default function Navbar({ user }) {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const isAdminPage = pathname?.startsWith('/admin')

  if (!user) return null

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-brand">
          <span className="navbar-brand-icon">◉</span> Attendance
        </Link>

        <div className="navbar-links">
          <Link href="/" className={`navbar-link ${isHome ? 'active' : ''}`}>
            <HomeIcon /> Home
          </Link>
          {user.isAdmin && (
            <Link href="/admin" className={`navbar-link ${isAdminPage ? 'active' : ''}`}>
              <ManageIcon /> Manage Attendance
            </Link>
          )}
        </div>

        <div className="navbar-user">
          <span className="navbar-user-name" title={user.email}>
            {user.name}
            {user.isAdmin && <span className="navbar-admin-badge">Admin</span>}
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn btn-icon navbar-logout">
              <LogoutIcon /> Logout
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
