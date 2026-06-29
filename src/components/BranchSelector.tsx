'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useCartStore } from '../store/cart'
import { nearestBranch, PublicBranch } from '../lib/branches'

type Props = {
  onChange?: (branchId: string) => void
  /** When true (default), asks for location once and auto-picks the nearest branch. */
  autoLocate?: boolean
  /** Label shown above the branch name. */
  title?: string
}

/**
 * Branch picker for the storefront.
 * On first load it (optionally) asks for the user's location and auto-selects
 * the nearest branch. The user can switch to any other branch from the dropdown.
 */
export default function BranchSelector({
  onChange,
  autoLocate = true,
  title = 'Ordering from',
}: Props) {
  const branchId = useCartStore((s) => s.branchId)
  const setBranch = useCartStore((s) => s.setBranch)

  const [branches, setBranches] = useState<PublicBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [autoPicked, setAutoPicked] = useState(false)

  // Load branches once.
  useEffect(() => {
    let cancelled = false
    fetch('/api/branches')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const list = (data.branches || []) as PublicBranch[]
        setBranches(list)
        // If nothing chosen yet, default to the first branch so the menu loads.
        if (!branchId && list.length) {
          const first = list[0]
          setBranch(first.id, first.name)
          onChange?.(first.id)
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Try to auto-select the nearest branch by geolocation (once).
  useEffect(() => {
    if (!autoLocate || autoPicked || branches.length === 0) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestBranch(branches, pos.coords.latitude, pos.coords.longitude)
        if (near) {
          setBranch(near.id, near.name)
          onChange?.(near.id)
        }
        setAutoPicked(true)
        setLocating(false)
      },
      () => {
        setAutoPicked(true)
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches])

  const selected = useMemo(
    () => branches.find((b) => b.id === branchId) || null,
    [branches, branchId]
  )

  function pick(id: string) {
    const b = branches.find((x) => x.id === id)
    if (!b || b.id === branchId) return
    setBranch(b.id, b.name)
    onChange?.(b.id)
  }

  if (loading || branches.length <= 0) return null

  return (
    <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#181818] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </p>
        <p className="mt-0.5 text-base font-semibold text-white">
          {selected ? selected.name : 'Select a branch'}
          {locating && (
            <span className="ml-2 text-xs font-normal text-gray-500">
              finding nearest…
            </span>
          )}
        </p>
        {selected?.address && (
          <p className="text-xs text-gray-500">{selected.address}</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">Branch</span>
        <select
          value={branchId}
          onChange={(e) => pick(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#101010] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
