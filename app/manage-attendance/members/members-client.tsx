// @ts-nocheck
'use client'

import { useEffect, useState, useCallback } from 'react'

export default function MembersClient() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState(null) // index or 'new'
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'employee' })
  const [saving, setSaving] = useState(false)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/members')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to load')
      setMembers(data.members || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMembers()
  }, [fetchMembers])

  const startAdd = () => {
    setForm({ name: '', email: '', phone: '', role: 'employee' })
    setEditing('new')
    setError('')
    setSuccess('')
  }

  const startEdit = (idx) => {
    const m = members[idx]
    setForm({ name: m.name, email: m.email, phone: m.phone || '', role: m.role || 'employee' })
    setEditing(idx)
    setError('')
    setSuccess('')
  }

  const cancelEdit = () => {
    setEditing(null)
    setForm({ name: '', email: '', phone: '', role: 'employee' })
  }

  const handleSave = async () => {
    if (!form.email.includes('@') || !form.name.trim()) {
      setError('Name and valid Gmail required')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (editing === 'new') {
        const res = await fetch('/api/admin/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Add failed')
        setSuccess('Member added')
      } else {
        const res = await fetch('/api/admin/members', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: editing, ...form }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Update failed')
        setSuccess('Member updated')
      }
      setEditing(null)
      await fetchMembers()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (idx) => {
    if (!confirm(`Delete ${members[idx]?.email}?`)) return
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/admin/members?index=${idx}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Delete failed')
      setSuccess('Member deleted')
      await fetchMembers()
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) {
    return (
      <div className="page admin-page">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="page admin-page">
      <div className="admin-page-header">
        <h2>Employees / Members</h2>
        <p className="admin-page-subtitle">
          Manage full name, Gmail, phone, role. Data is stored in the <strong>Employees</strong> sheet — edit here or directly in Google Sheets (dynamic, no database).
        </p>
      </div>

      {error && <p className="attendance-status error">{error}</p>}
      {success && <p className="attendance-status success">{success}</p>}

      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <span style={{ fontSize: 14, fontWeight: 600 }}>Total: {members.length}</span>
        </div>
        <div className="admin-toolbar-right">
          <button className="btn" onClick={fetchMembers} disabled={loading}>
            Refresh
          </button>
          <button className="btn primary btn-icon" onClick={startAdd} disabled={editing !== null}>
            + Add Member
          </button>
        </div>
      </div>

      {editing !== null && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{editing === 'new' ? 'Add Member' : 'Edit Member'}</h3>
          <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
              Full Name
              <input
                className="attendance-select"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Nepolion Chakma"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
              Gmail
              <input
                className="attendance-select"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@gmail.com"
                disabled={editing !== 'new'}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
              Phone
              <input
                className="attendance-select"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="017..."
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600 }}>
              Role
              <select
                className="attendance-select"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="employee">employee</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Update'}
              </button>
              <button className="btn" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Full Name</th>
              <th>Gmail</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text)' }}>
                  No members yet — add from above or enter directly in the Employees sheet.
                </td>
              </tr>
            ) : (
              members.map((m, idx) => (
                <tr key={m.email + idx}>
                  <td>{idx + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-h)' }}>{m.name}</td>
                  <td>{m.email}</td>
                  <td>{m.phone || '—'}</td>
                  <td>
                    <span className={`home-you-badge`} style={{ background: m.role === 'admin' ? 'var(--accent)' : '#64748b' }}>
                      {m.role}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => startEdit(idx)}>
                        Edit
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '6px 10px', fontSize: 13, color: '#e5484d', borderColor: '#e5484d' }}
                        onClick={() => handleDelete(idx)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
        Tip: You can also edit the <strong>Employees</strong> sheet directly in Google Sheets — the app always reads the latest (cached 60s). Add `Full Name`, `Gmail`, `Phone`, `Role` columns.
      </p>
    </div>
  )
}
