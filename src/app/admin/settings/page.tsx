'use client'
import React, { useEffect, useState } from 'react'

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
      .catch(() => {})
  }, [])

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
            className={`text-sm ${
              msg.includes('Failed') ? 'text-red-400' : 'text-green-400'
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}
