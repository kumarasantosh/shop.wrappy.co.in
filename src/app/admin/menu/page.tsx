'use client'
import React, { useEffect, useState } from 'react'
import { BranchRecord } from '../../../lib/branches'

type MenuItem = {
  product_id: string
  name: string
  base_price: number
  is_veg: boolean
  category: string
  branch_available: boolean
  price_override: number | null
}

const input = 'rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white'

export default function AdminBranchMenuPage() {
  const [branches, setBranches] = useState<BranchRecord[]>([])
  const [branchId, setBranchId] = useState('')
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/branches?all=1')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.branches || []) as BranchRecord[]
        setBranches(list)
        if (list.length) setBranchId(list[0].id)
      })
      .catch(() => {})
  }, [])

  async function loadMenu(id: string) {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/branches/menu?branchId=${id}`)
      const data = await res.json()
      setItems((data.items || []) as MenuItem[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (branchId) loadMenu(branchId).catch(() => {})
  }, [branchId])

  async function save(productId: string, updates: { is_available?: boolean; price_override?: number | null }) {
    setSavingId(productId)
    setItems((prev) =>
      prev.map((it) =>
        it.product_id === productId
          ? {
              ...it,
              branch_available: updates.is_available ?? it.branch_available,
              price_override: updates.price_override !== undefined ? updates.price_override : it.price_override,
            }
          : it
      )
    )
    try {
      await fetch('/api/branches/menu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, product_id: productId, ...updates }),
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Branch Menu</h2>
        <select className={input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Toggle availability or set a price override for this branch. Leave the price blank to use the catalogue price.
      </p>

      {loading ? (
        <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.product_id} className="grid grid-cols-1 items-center gap-3 rounded-xl border border-white/10 bg-[#181818] p-4 md:grid-cols-[1fr_120px_160px_120px]">
              <div>
                <p className="text-sm font-medium text-white">
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full ${it.is_veg ? 'bg-green-500' : 'bg-red-500'}`} />
                  {it.name}
                </p>
                <p className="text-xs text-gray-500">{it.category} · base ₹{it.base_price}</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={it.branch_available}
                  onChange={(e) => save(it.product_id, { is_available: e.target.checked })}
                />
                {it.branch_available ? 'Available' : 'Hidden'}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                ₹ override
                <input
                  type="number"
                  className={`${input} w-24`}
                  defaultValue={it.price_override ?? ''}
                  placeholder={String(it.base_price)}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    save(it.product_id, { price_override: v === '' ? null : Number(v) })
                  }}
                />
              </label>
              <span className="text-xs text-gray-600">{savingId === it.product_id ? 'saving…' : ''}</span>
            </div>
          ))}
          {!items.length && <p className="py-8 text-center text-sm text-gray-500">No products found.</p>}
        </div>
      )}
    </div>
  )
}
