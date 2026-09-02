'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'

interface Member {
  name: string
  email: string
  phone: string
  role: string
}

interface PendingEdit {
  name: string
  email: string
  phone: string
  role: string
}

const ROLE_OPTIONS = ['employee', 'admin']

function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v7h-7" />
    </svg>
  )
}

export default function MembersClient() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddRow, setShowAddRow] = useState(false)
  const [newRow, setNewRow] = useState<PendingEdit>({ name: '', email: '', phone: '', role: 'employee' })

  const [pendingEdits, setPendingEdits] = useState<Record<number, PendingEdit>>({})
  const [pendingAdds, setPendingAdds] = useState<PendingEdit[]>([])

  const pendingCount = useMemo(() => Object.keys(pendingEdits).length + pendingAdds.length, [pendingEdits, pendingAdds])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/members')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to load')
      setMembers(data.members || [])
      setPendingEdits({})
      setPendingAdds([])
      setShowAddRow(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const handleCellEdit = (idx: number, field: keyof PendingEdit, value: string) => {
    setPendingEdits((prev) => {
      const existing = prev[idx] || { ...members[idx] }
      return { ...prev, [idx]: { ...existing, [field]: value } }
    })
    setError('')
    setSuccess('')
  }

  const handleNewRowEdit = (field: keyof PendingEdit, value: string) => {
    setNewRow((prev) => ({ ...prev, [field]: value }))
  }

  const addNewRow = () => {
    if (!newRow.name.trim() || !newRow.email.includes('@')) {
      setError('Name and valid email required for new member')
      return
    }
    setPendingAdds((prev) => [...prev, { ...newRow }])
    setNewRow({ name: '', email: '', phone: '', role: 'employee' })
    setShowAddRow(false)
    setError('')
    setSuccess('')
  }

  const removePendingAdd = (addIdx: number) => {
    setPendingAdds((prev) => prev.filter((_, i) => i !== addIdx))
  }

  const cancelEdit = (idx: number) => {
    setPendingEdits((prev) => {
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  const handleSave = async () => {
    if (pendingCount === 0 || saving) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      let updated = 0
      for (const [idxStr, edit] of Object.entries(pendingEdits)) {
        const idx = Number(idxStr)
        const res = await fetch('/api/admin/members', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: idx, ...edit }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.message || `Failed to update row ${idx + 1}`)
        }
        updated++
      }
      for (const add of pendingAdds) {
        const res = await fetch('/api/admin/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(add),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.message || 'Failed to add member')
        }
        updated++
      }
      setSuccess(`Saved ${updated} change${updated > 1 ? 's' : ''}`)
      setPendingEdits({})
      setPendingAdds([])
      await fetchMembers()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (idx: number) => {
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
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const discardAll = () => {
    setPendingEdits({})
    setPendingAdds([])
    setShowAddRow(false)
    setNewRow({ name: '', email: '', phone: '', role: 'employee' })
    setError('')
    setSuccess('')
  }

  if (loading && members.length === 0) {
    return (
      <div className="page admin-page">
        <p>Loading…</p>
      </div>
    )
  }

  const displayMembers = members.map((m, idx) => {
    const edit = pendingEdits[idx]
    return edit ? { ...m, ...edit, _dirty: true } : { ...m, _dirty: false }
  })

  return (
    <div className="page admin-page">
      <div className="admin-page-header">
        <h2>Employees / Members</h2>
        <p className="admin-page-subtitle">
          Edit inline — changes stay local until you press <strong>Save</strong>. Data is in the <strong>Employees</strong> sheet.
        </p>
      </div>

      {error && <p className="attendance-status error">{error}</p>}
      {success && <p className="attendance-status success">{success}</p>}

      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Total: {members.length + pendingAdds.length}
            {pendingCount > 0 && <span className="admin-pending-badge" style={{ marginLeft: 8 }}><span className="admin-pending-dot" /> {pendingCount} unsaved</span>}
          </span>
        </div>
        <div className="admin-toolbar-right">
          <button className="btn btn-icon" onClick={fetchMembers} disabled={loading || saving} title="Refresh">
            <RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="btn" onClick={discardAll} disabled={pendingCount === 0 || saving}>
            Discard
          </button>
          <button className="btn primary btn-icon" onClick={handleSave} disabled={pendingCount === 0 || saving}>
            <SaveIcon /> {saving ? 'Saving…' : `Save${pendingCount ? ` · ${pendingCount}` : ''}`}
          </button>
          <button className="btn primary btn-icon" onClick={() => { setShowAddRow(true); setError(''); setSuccess('') }} disabled={showAddRow || saving}>
            + Add New
          </button>
        </div>
      </div>

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
            {displayMembers.length === 0 && pendingAdds.length === 0 && !showAddRow ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text)' }}>
                  No members yet — click <strong>+ Add New</strong> to create one.
                </td>
              </tr>
            ) : (
              <>
                {showAddRow && (
                  <tr className="admin-row-new">
                    <td>1</td>
                    <td>
                      <input className="admin-inline-input" value={newRow.name} onChange={(e) => handleNewRowEdit('name', e.target.value)} placeholder="Full name" autoFocus />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={newRow.email} onChange={(e) => handleNewRowEdit('email', e.target.value)} placeholder="name@gmail.com" />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={newRow.phone} onChange={(e) => handleNewRowEdit('phone', e.target.value)} placeholder="017..." />
                    </td>
                    <td>
                      <select className="admin-cell-select" value={newRow.role} onChange={(e) => handleNewRowEdit('role', e.target.value)}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn primary" style={{ padding: '6px 10px', fontSize: 13 }} onClick={addNewRow}>Add</button>
                        <button className="btn" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => setShowAddRow(false)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}

                {displayMembers.map((m, idx) => (
                  <tr key={m.email + idx} className={m._dirty ? 'admin-row-dirty' : ''}>
                    <td>{showAddRow ? idx + 2 : idx + 1}</td>
                    <td>
                      <input className="admin-inline-input" value={m.name} onChange={(e) => handleCellEdit(idx, 'name', e.target.value)} disabled={saving} />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={m.email} onChange={(e) => handleCellEdit(idx, 'email', e.target.value)} disabled={saving} />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={m.phone || ''} onChange={(e) => handleCellEdit(idx, 'phone', e.target.value)} disabled={saving} placeholder="—" />
                    </td>
                    <td>
                      <select className="admin-cell-select" value={m.role} onChange={(e) => handleCellEdit(idx, 'role', e.target.value)} disabled={saving}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {m._dirty && <span className="admin-dirty-dot" title="Unsaved" />}
                        <button className="btn" style={{ padding: '6px 10px', fontSize: 13, color: '#e5484d', borderColor: '#e5484d' }} onClick={() => handleDelete(idx)} disabled={saving}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}

                {pendingAdds.map((add, addIdx) => (
                  <tr key={`pending-${addIdx}`} className="admin-row-new">
                    <td>+</td>
                    <td>
                      <input className="admin-inline-input" value={add.name} placeholder="Full name" disabled={saving}
                        onChange={(e) => { const u = [...pendingAdds]; u[addIdx] = { ...u[addIdx], name: e.target.value }; setPendingAdds(u) }} />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={add.email} placeholder="name@gmail.com" disabled={saving}
                        onChange={(e) => { const u = [...pendingAdds]; u[addIdx] = { ...u[addIdx], email: e.target.value }; setPendingAdds(u) }} />
                    </td>
                    <td>
                      <input className="admin-inline-input" value={add.phone} placeholder="017..." disabled={saving}
                        onChange={(e) => { const u = [...pendingAdds]; u[addIdx] = { ...u[addIdx], phone: e.target.value }; setPendingAdds(u) }} />
                    </td>
                    <td>
                      <select className="admin-cell-select" value={add.role} disabled={saving}
                        onChange={(e) => { const u = [...pendingAdds]; u[addIdx] = { ...u[addIdx], role: e.target.value }; setPendingAdds(u) }}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="btn" style={{ padding: '6px 10px', fontSize: 13, color: '#e5484d', borderColor: '#e5484d' }} onClick={() => removePendingAdd(addIdx)} disabled={saving}>Remove</button>
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
