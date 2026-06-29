'use client'
import React, { useEffect, useState } from 'react'
import { BranchMemberRecord, BranchRecord, BranchRole } from '../../../lib/branches'

const input =
  'rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white placeholder:text-gray-600'

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<BranchRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [members, setMembers] = useState<BranchMemberRecord[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newBranch, setNewBranch] = useState({ name: '', address: '', latitude: '', longitude: '' })
  const [newMember, setNewMember] = useState<{ email: string; role: BranchRole }>({ email: '', role: 'staff' })

  async function loadBranches() {
    const res = await fetch('/api/branches?all=1')
    const data = await res.json()
    const list = (data.branches || []) as BranchRecord[]
    setBranches(list)
    if (!selectedId && list.length) setSelectedId(list[0].id)
  }

  async function loadMembers(branchId: string) {
    if (!branchId) return
    const res = await fetch(`/api/branches/members?branchId=${branchId}`)
    const data = await res.json()
    setMembers((data.members || []) as BranchMemberRecord[])
  }

  useEffect(() => {
    loadBranches().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId) loadMembers(selectedId).catch(() => {})
  }, [selectedId])

  function patchLocal(id: string, updates: Partial<BranchRecord>) {
    setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)))
  }

  async function saveBranch(b: BranchRecord) {
    setSavingId(b.id)
    try {
      await fetch('/api/branches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: b.id,
          name: b.name,
          address: b.address,
          city: b.city,
          phone: b.phone,
          latitude: b.latitude === null || b.latitude === undefined || (b.latitude as any) === '' ? null : Number(b.latitude),
          longitude: b.longitude === null || b.longitude === undefined || (b.longitude as any) === '' ? null : Number(b.longitude),
          open_time: b.open_time,
          close_time: b.close_time,
          estimated_delivery_minutes: Number(b.estimated_delivery_minutes || 30),
          force_closed: b.force_closed,
          is_active: b.is_active,
        }),
      })
      await loadBranches()
    } finally {
      setSavingId(null)
    }
  }

  async function createBranch(e: React.FormEvent) {
    e.preventDefault()
    if (!newBranch.name.trim()) return
    await fetch('/api/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newBranch.name.trim(),
        address: newBranch.address.trim() || null,
        latitude: newBranch.latitude ? Number(newBranch.latitude) : null,
        longitude: newBranch.longitude ? Number(newBranch.longitude) : null,
      }),
    })
    setNewBranch({ name: '', address: '', latitude: '', longitude: '' })
    await loadBranches()
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    if (!newMember.email.trim() || !selectedId) return
    await fetch('/api/branches/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: selectedId, email: newMember.email.trim(), role: newMember.role }),
    })
    setNewMember({ email: '', role: 'staff' })
    await loadMembers(selectedId)
  }

  async function updateMember(id: string, updates: Partial<BranchMemberRecord>) {
    await fetch('/api/branches/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    await loadMembers(selectedId)
  }

  async function deleteMember(id: string) {
    if (!window.confirm('Remove this member?')) return
    await fetch(`/api/branches/members?id=${id}`, { method: 'DELETE' })
    await loadMembers(selectedId)
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Branches</h2>

      <form
        onSubmit={createBranch}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#181818] p-5 md:grid-cols-5"
      >
        <input className={input} placeholder="New branch name" value={newBranch.name} onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} />
        <input className={input} placeholder="Address" value={newBranch.address} onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })} />
        <input className={input} placeholder="Latitude" value={newBranch.latitude} onChange={(e) => setNewBranch({ ...newBranch, latitude: e.target.value })} />
        <input className={input} placeholder="Longitude" value={newBranch.longitude} onChange={(e) => setNewBranch({ ...newBranch, longitude: e.target.value })} />
        <button type="submit" className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-gray-200">Add Branch</button>
      </form>

      <div className="space-y-4">
        {branches.map((b) => (
          <div key={b.id} className="rounded-2xl border border-white/10 bg-[#181818] p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-xs text-gray-500">Name
                <input className={`${input} mt-1 w-full`} value={b.name} onChange={(e) => patchLocal(b.id, { name: e.target.value })} />
              </label>
              <label className="text-xs text-gray-500">Phone
                <input className={`${input} mt-1 w-full`} value={b.phone || ''} onChange={(e) => patchLocal(b.id, { phone: e.target.value })} />
              </label>
              <label className="text-xs text-gray-500">City
                <input className={`${input} mt-1 w-full`} value={b.city || ''} onChange={(e) => patchLocal(b.id, { city: e.target.value })} />
              </label>
              <label className="text-xs text-gray-500 md:col-span-3">Address
                <input className={`${input} mt-1 w-full`} value={b.address || ''} onChange={(e) => patchLocal(b.id, { address: e.target.value })} />
              </label>
              <label className="text-xs text-gray-500">Latitude
                <input className={`${input} mt-1 w-full`} value={b.latitude ?? ''} onChange={(e) => patchLocal(b.id, { latitude: e.target.value as any })} />
              </label>
              <label className="text-xs text-gray-500">Longitude
                <input className={`${input} mt-1 w-full`} value={b.longitude ?? ''} onChange={(e) => patchLocal(b.id, { longitude: e.target.value as any })} />
              </label>
              <label className="text-xs text-gray-500">Est. delivery (min)
                <input type="number" className={`${input} mt-1 w-full`} value={b.estimated_delivery_minutes} onChange={(e) => patchLocal(b.id, { estimated_delivery_minutes: Number(e.target.value || 0) })} />
              </label>
              <label className="text-xs text-gray-500">Open
                <input type="time" className={`${input} mt-1 w-full`} value={String(b.open_time).slice(0, 5)} onChange={(e) => patchLocal(b.id, { open_time: e.target.value })} />
              </label>
              <label className="text-xs text-gray-500">Close
                <input type="time" className={`${input} mt-1 w-full`} value={String(b.close_time).slice(0, 5)} onChange={(e) => patchLocal(b.id, { close_time: e.target.value })} />
              </label>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={b.force_closed} onChange={(e) => patchLocal(b.id, { force_closed: e.target.checked })} />
                  Force closed
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={b.is_active} onChange={(e) => patchLocal(b.id, { is_active: e.target.checked })} />
                  Active
                </label>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button onClick={() => saveBranch(b)} disabled={savingId === b.id} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                {savingId === b.id ? 'Saving…' : 'Save branch'}
              </button>
              <button onClick={() => setSelectedId(b.id)} className={`rounded-lg border px-4 py-2 text-sm ${selectedId === b.id ? 'border-white/40 text-white' : 'border-white/10 text-gray-400'}`}>
                Manage staff
              </button>
            </div>

            {selectedId === b.id && (
              <div className="mt-5 rounded-xl border border-white/10 bg-[#101010] p-4">
                <p className="mb-3 text-sm font-semibold text-white">Staff &amp; admins — {b.name}</p>
                <form onSubmit={addMember} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_120px]">
                  <input className={input} placeholder="email@example.com" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} />
                  <select className={input} value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value as BranchRole })}>
                    <option value="admin">admin</option>
                    <option value="staff">staff</option>
                  </select>
                  <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black">Add</button>
                </form>
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/10 bg-[#181818] p-3 md:grid-cols-[1fr_120px_120px_90px]">
                      <span className="text-sm text-white">{m.email}</span>
                      <select className={input} value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value as BranchRole })}>
                        <option value="admin">admin</option>
                        <option value="staff">staff</option>
                      </select>
                      <label className="flex items-center gap-2 text-xs text-gray-400">
                        <input type="checkbox" checked={m.is_active} onChange={(e) => updateMember(m.id, { is_active: e.target.checked })} />
                        active
                      </label>
                      <button onClick={() => deleteMember(m.id)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">Remove</button>
                    </div>
                  ))}
                  {!members.length && <p className="py-3 text-center text-xs text-gray-500">No members yet.</p>}
                </div>
              </div>
            )}
          </div>
        ))}
        {!branches.length && <p className="py-8 text-center text-sm text-gray-500">No branches yet.</p>}
      </div>
    </div>
  )
}
