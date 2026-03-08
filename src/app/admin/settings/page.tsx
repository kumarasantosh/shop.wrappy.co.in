'use client'
import React, { useEffect, useState } from 'react'
import { AdminPhoneRecord } from '../../../lib/types'

type SettingsState = {
  open_time: string
  close_time: string
  allow_preorder: boolean
  force_closed: boolean
  estimated_delivery_minutes: number
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<SettingsState>({
    open_time: '10:00',
    close_time: '22:00',
    allow_preorder: false,
    force_closed: false,
    estimated_delivery_minutes: 30,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Admin phones state
  const [phones, setPhones] = useState<AdminPhoneRecord[]>([])
  const [newPhone, setNewPhone] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [addingPhone, setAddingPhone] = useState(false)

  useEffect(() => {
    fetch('/api/store-settings')
      .then((response) => response.json())
      .then((payload) => {
        if (payload.open_time) {
          setSettings({
            open_time: String(payload.open_time).slice(0, 5),
            close_time: String(payload.close_time).slice(0, 5),
            allow_preorder: Boolean(payload.allow_preorder),
            force_closed: Boolean(payload.force_closed),
            estimated_delivery_minutes: Number(
              payload.estimated_delivery_minutes || 30
            ),
          })
        }
      })
      .catch(() => { })
  }, [])

  useEffect(() => {
    fetchPhones()
  }, [])

  async function fetchPhones() {
    try {
      const res = await fetch('/api/admin/phones')
      const data = await res.json()
      setPhones((data.phones || []) as AdminPhoneRecord[])
    } catch {
      /* ignore */
    }
  }

  async function addPhone() {
    if (!newPhone.trim()) return
    setAddingPhone(true)
    try {
      await fetch('/api/admin/phones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: newPhone.trim(), label: newLabel.trim() || null }),
      })
      setNewPhone('')
      setNewLabel('')
      await fetchPhones()
    } finally {
      setAddingPhone(false)
    }
  }

  async function removePhone(id: string) {
    if (!window.confirm('Remove this admin phone?')) return
    await fetch(`/api/admin/phones?id=${id}`, { method: 'DELETE' })
    await fetchPhones()
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const response = await fetch('/api/store-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!response.ok) {
        setMsg('Failed to save settings')
      } else {
        setMsg('Settings saved')
      }
    } catch {
      setMsg('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-4 text-xl font-semibold">Store Settings</h2>

        <div className="max-w-xl space-y-5 rounded-2xl border border-white/10 bg-[#181818] p-6">
          <div>
            <label className="mb-1 block text-sm text-gray-500">Opening Time</label>
            <input
              type="time"
              value={settings.open_time}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, open_time: event.target.value }))
              }
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-500">Closing Time</label>
            <input
              type="time"
              value={settings.close_time}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, close_time: event.target.value }))
              }
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-500">
              Estimated Delivery Time (minutes)
            </label>
            <input
              type="number"
              min={10}
              max={180}
              value={settings.estimated_delivery_minutes}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  estimated_delivery_minutes: Number(event.target.value || 30),
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={settings.allow_preorder}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  allow_preorder: event.target.checked,
                }))
              }
              className="rounded"
            />
            <span className="text-sm text-gray-400">
              Accept pre-orders when store is closed
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={settings.force_closed}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  force_closed: event.target.checked,
                }))
              }
              className="rounded"
            />
            <span className="text-sm text-gray-400">
              Force close store (ignore time settings)
            </span>
          </label>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          {msg && (
            <p
              className={`text-sm ${msg.includes('Failed') ? 'text-red-400' : 'text-green-400'
                }`}
            >
              {msg}
            </p>
          )}
        </div>
      </div>

      {/* ─── Admin Phone Numbers ─── */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Admin Phone Numbers</h2>
        <div className="max-w-xl space-y-4 rounded-2xl border border-white/10 bg-[#181818] p-6">
          <p className="text-xs text-gray-500">
            These numbers receive a WhatsApp alert when an order is not accepted within 5 minutes.
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Phone (e.g. 919182285342)"
              className="flex-1 rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-36 rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
            />
            <button
              type="button"
              onClick={addPhone}
              disabled={addingPhone || !newPhone.trim()}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              {addingPhone ? 'Adding...' : 'Add'}
            </button>
          </div>

          {phones.length === 0 ? (
            <p className="text-sm text-gray-600">No admin phones added yet.</p>
          ) : (
            <div className="space-y-2">
              {phones.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#222] px-4 py-3"
                >
                  <div>
                    <p className="text-sm text-white">{p.phone}</p>
                    {p.label && <p className="text-xs text-gray-500">{p.label}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhone(p.id)}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
