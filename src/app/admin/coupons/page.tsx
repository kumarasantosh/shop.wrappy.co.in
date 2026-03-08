'use client'
import React, { useEffect, useState } from 'react'
import { CouponRecord, CouponType } from '../../../lib/types'

type CouponFormState = {
  code: string
  type: CouponType
  value: string
  min_order: string
  usage_limit: string
  expires_at: string
  is_active: boolean
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<CouponRecord[]>([])
  const [form, setForm] = useState<CouponFormState>({
    code: '',
    type: 'percent',
    value: '',
    min_order: '',
    usage_limit: '',
    expires_at: '',
    is_active: true,
  })
  const [editForm, setEditForm] = useState<CouponFormState>({
    code: '',
    type: 'percent',
    value: '',
    min_order: '',
    usage_limit: '',
    expires_at: '',
    is_active: true,
  })
  const [creating, setCreating] = useState(false)
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingCouponId, setDeletingCouponId] = useState<string | null>(null)
  const [togglingCouponId, setTogglingCouponId] = useState<string | null>(null)

  async function fetchCoupons() {
    const response = await fetch('/api/coupons')
    const payload = await response.json()
    setCoupons((payload.coupons || []) as CouponRecord[])
  }

  useEffect(() => {
    fetchCoupons().catch(() => {})
  }, [])

  async function createCoupon(event: React.FormEvent) {
    event.preventDefault()
    if (!form.code || !form.value) return

    setCreating(true)
    try {
      await fetch('/api/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.toUpperCase(),
          type: form.type,
          value: Number(form.value),
          min_order: Number(form.min_order || 0),
          usage_limit: Number(form.usage_limit || 0),
          expires_at: toIso(form.expires_at),
          is_active: form.is_active,
        }),
      })
      setForm({
        code: '',
        type: 'percent',
        value: '',
        min_order: '',
        usage_limit: '',
        expires_at: '',
        is_active: true,
      })
      fetchCoupons()
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(coupon: CouponRecord) {
    setTogglingCouponId(coupon.id)
    try {
      await fetch('/api/coupons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: coupon.id, is_active: !coupon.is_active }),
      })
      fetchCoupons()
    } finally {
      setTogglingCouponId(null)
    }
  }

  function startEdit(coupon: CouponRecord) {
    setEditingCouponId(coupon.id)
    setEditForm({
      code: coupon.code,
      type: coupon.type,
      value: String(coupon.value),
      min_order: String(coupon.min_order || 0),
      usage_limit: String(coupon.usage_limit || 0),
      expires_at: toDateTimeLocal(coupon.expires_at),
      is_active: coupon.is_active,
    })
  }

  function cancelEdit() {
    setEditingCouponId(null)
    setSavingEdit(false)
  }

  async function saveCouponEdit() {
    if (!editingCouponId || !editForm.code || !editForm.value) return

    setSavingEdit(true)
    try {
      const response = await fetch('/api/coupons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCouponId,
          code: editForm.code.toUpperCase(),
          type: editForm.type,
          value: Number(editForm.value),
          min_order: Number(editForm.min_order || 0),
          usage_limit: Number(editForm.usage_limit || 0),
          expires_at: toIso(editForm.expires_at),
          is_active: editForm.is_active,
        }),
      })

      if (!response.ok) {
        alert('Failed to update coupon')
        return
      }

      cancelEdit()
      fetchCoupons()
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteCoupon(id: string, code: string) {
    const confirmed = window.confirm(`Delete coupon "${code}"?`)
    if (!confirmed) return

    setDeletingCouponId(id)
    try {
      await fetch(`/api/coupons?id=${id}`, { method: 'DELETE' })
      if (editingCouponId === id) cancelEdit()
      fetchCoupons()
    } finally {
      setDeletingCouponId(null)
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Coupons</h2>

      <form
        onSubmit={createCoupon}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#181818] p-5 md:grid-cols-3"
      >
        <input
          placeholder="Code (WELCOME10)"
          value={form.code}
          onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <select
          value={form.type}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, type: event.target.value as CouponType }))
          }
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
        >
          <option value="percent">Percentage (%)</option>
          <option value="flat">Flat (₹)</option>
          <option value="first_order">First Order</option>
        </select>
        <input
          placeholder="Value"
          type="number"
          value={form.value}
          onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <input
          placeholder="Min order (₹)"
          type="number"
          value={form.min_order}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, min_order: event.target.value }))
          }
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <input
          placeholder="Usage limit (0 = unlimited)"
          type="number"
          value={form.usage_limit}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, usage_limit: event.target.value }))
          }
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <input
          type="datetime-local"
          value={form.expires_at}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, expires_at: event.target.value }))
          }
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
        />

        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, is_active: event.target.checked }))
            }
            className="rounded"
          />
          Active coupon
        </label>

        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:opacity-60"
        >
          {creating ? 'Creating...' : 'Create Coupon'}
        </button>
      </form>

      <div className="space-y-2">
        {coupons.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No coupons yet</p>
        ) : (
          coupons.map((coupon) => (
            <div
              key={coupon.id}
              className="rounded-xl border border-white/10 bg-[#181818] p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-sm font-semibold">{coupon.code}</p>
                  <p className="text-xs text-gray-500">
                    {coupon.type === 'percent'
                      ? `${coupon.value}% off`
                      : `₹${coupon.value} off`}
                    {coupon.min_order ? ` • Min ₹${coupon.min_order}` : ''}
                    {coupon.type === 'first_order' ? ' • First order only' : ''}
                  </p>
                  <p className="text-xs text-gray-600">
                    Used {coupon.used_count} /{' '}
                    {coupon.usage_limit === 0 ? '∞' : coupon.usage_limit}
                    {coupon.expires_at
                      ? ` • Expires ${new Date(coupon.expires_at).toLocaleString()}`
                      : ' • No expiry'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(coupon)}
                    disabled={togglingCouponId === coupon.id}
                    className={`rounded-lg px-3 py-1.5 text-xs disabled:opacity-60 ${
                      coupon.is_active
                        ? 'border border-green-500/20 bg-green-500/10 text-green-300'
                        : 'border border-gray-500/20 bg-gray-500/10 text-gray-300'
                    }`}
                  >
                    {togglingCouponId === coupon.id
                      ? 'Updating...'
                      : coupon.is_active
                        ? 'Active'
                        : 'Inactive'}
                  </button>
                  <button
                    onClick={() => startEdit(coupon)}
                    className="rounded-lg border border-white/10 bg-[#222] px-3 py-1.5 text-xs text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteCoupon(coupon.id, coupon.code)}
                    disabled={deletingCouponId === coupon.id}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
                  >
                    {deletingCouponId === coupon.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>

              {editingCouponId === coupon.id && (
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/10 pt-4 md:grid-cols-3">
                  <input
                    placeholder="Code"
                    value={editForm.code}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, code: event.target.value }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                  />
                  <select
                    value={editForm.type}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        type: event.target.value as CouponType,
                      }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="flat">Flat (₹)</option>
                    <option value="first_order">First Order</option>
                  </select>
                  <input
                    placeholder="Value"
                    type="number"
                    value={editForm.value}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, value: event.target.value }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                  />
                  <input
                    placeholder="Min order (₹)"
                    type="number"
                    value={editForm.min_order}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, min_order: event.target.value }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                  />
                  <input
                    placeholder="Usage limit"
                    type="number"
                    value={editForm.usage_limit}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        usage_limit: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                  />
                  <input
                    type="datetime-local"
                    value={editForm.expires_at}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, expires_at: event.target.value }))
                    }
                    className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-400 md:col-span-3">
                    <input
                      type="checkbox"
                      checked={editForm.is_active}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                      className="rounded"
                    />
                    Active coupon
                  </label>
                  <div className="flex items-center justify-end gap-2 md:col-span-3">
                    <button
                      onClick={cancelEdit}
                      className="rounded-lg border border-white/10 bg-[#222] px-4 py-2 text-sm text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveCouponEdit}
                      disabled={savingEdit}
                      className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                    >
                      {savingEdit ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
