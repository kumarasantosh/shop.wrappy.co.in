'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSession } from '@clerk/nextjs'
import PushAlertsButton from '../../../components/admin/PushAlertsButton'
import { parseOrderMeta, stripOrderMeta } from '../../../lib/orderMeta'
import { useClerkSupabaseClient } from '../../../lib/supabase'
import { OrderItemRecord, OrderRecord } from '../../../lib/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const ACCEPT_TIMER_SECONDS = 300

function formatMoney(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return '₹0'
  const hasDecimals = Math.abs(numeric % 1) > 0.000001
  return `₹${numeric.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

function timeSince(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/* ─── Accept Countdown Timer ─── */
function useAcceptTimer(createdAt: string) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
    return Math.max(0, ACCEPT_TIMER_SECONDS - elapsed)
  })

  useEffect(() => {
    if (remaining <= 0) return
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
      const next = Math.max(0, ACCEPT_TIMER_SECONDS - elapsed)
      setRemaining(next)
      if (next <= 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [createdAt, remaining])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const label = remaining > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : '0:00'
  const percent = (remaining / ACCEPT_TIMER_SECONDS) * 100

  return { remaining, label, percent }
}

/* ─── Order Card ─── */
function OrderCard({
  order,
  onAccept,
  onReject,
  onReady,
  onComplete,
  isUpdating = false,
  branchName,
}: {
  order: OrderRecord
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onReady: (id: string) => void
  onComplete: (id: string) => void
  isUpdating?: boolean
  branchName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyError, setVerifyError] = useState(false)
  const meta = parseOrderMeta(order.instructions)
  const cleanInstructions = stripOrderMeta(order.instructions)
  const items = (order.order_items || []) as OrderItemRecord[]
  const itemCount = items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  const isNew = order.status === 'placed'
  const isAccepted = order.status === 'preparing'
  const isReady = order.status === 'out_for_delivery'
  const timer = useAcceptTimer(order.created_at)
  const actionsDisabled = Boolean(isUpdating)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`rounded-2xl border p-4 ${isNew
        ? 'border-red-500/30 bg-red-500/5 shadow-[0_0_20px_rgba(239,68,68,0.08)]'
        : isAccepted
          ? 'border-yellow-500/20 bg-yellow-500/5'
          : 'border-green-500/20 bg-green-500/5'
        }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">
              #{order.id?.slice(0, 8)}
            </p>
            <span className="text-[11px] text-gray-500">
              {order.created_at ? timeSince(order.created_at) : ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {meta.orderType === 'pickup' ? '📦 Self Pickup' : '🚚 Delivery'}
            {' · '}{order.phone || 'No phone'}
          </p>
          {branchName && (
            <p className="mt-0.5 inline-block rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
              🏬 {branchName}
            </p>
          )}
          {meta.orderType === 'pickup' && meta.pickupCode && (
            <p className="mt-0.5 text-xs text-emerald-400">
              Code: {meta.pickupCode}
              {meta.pickupSlot
                ? ` · ${new Date(meta.pickupSlot).toLocaleString([], {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}`
                : ''}
            </p>
          )}
        </div>
        <p className="text-lg font-bold text-white">{formatMoney(order.total)}</p>
      </div>

      {/* Items summary */}
      <div className="mb-3 space-y-1">
        {items.slice(0, expanded ? items.length : 3).map((item) => {
          const name = item.product?.name || `Item ${String(item.product_id).slice(0, 6)}`
          return (
            <div key={item.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-300">
                {item.product?.is_veg ? '🟢' : '🔴'} {name} ×{item.qty}
              </span>
              <span className="text-gray-400">{formatMoney(Number(item.price || 0) * Number(item.qty || 0))}</span>
            </div>
          )
        })}
        {items.length > 3 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300"
          >
            +{items.length - 3} more items
          </button>
        )}
      </div>

      {/* Addons & notes (when expanded) */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mb-3 space-y-2 border-t border-white/10 pt-3">
              {/* Bill breakdown */}
              <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-300">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span><span>{formatMoney(order.subtotal)}</span>
                  </div>
                  {Number(order.discount) > 0 && (
                    <div className="flex justify-between text-green-400">
                      <span>Discount</span><span>-{formatMoney(order.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Tax</span><span>{formatMoney(order.tax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Packing</span><span>{formatMoney(order.packing_fee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-1 font-semibold text-white">
                    <span>Total</span><span>{formatMoney(order.total)}</span>
                  </div>
                </div>
              </div>

              {/* Address */}
              {meta.orderType !== 'pickup' && order.address && (
                <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-400">
                  <span className="text-gray-500">📍 </span>{order.address}
                </div>
              )}

              {/* Notes */}
              {cleanInstructions && (
                <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-400">
                  <span className="text-gray-500">📝 </span>{cleanInstructions}
                </div>
              )}

              {/* Payment info */}
              <div className="text-[11px] text-gray-500">
                {order.payment_method || 'razorpay'} · {order.payment_status || 'pending'}
                {order.coupon_code ? ` · Coupon: ${order.coupon_code}` : ''}
              </div>

              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[11px] text-gray-500 hover:text-gray-400"
              >
                Show less
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Items count + expand toggle */}
      {!expanded && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {itemCount} item{itemCount !== 1 ? 's' : ''} · {order.payment_method || 'razorpay'}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300"
          >
            Details
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {isNew && (
          <>
            <button
              type="button"
              onClick={() => onAccept(order.id)}
              disabled={actionsDisabled}
              className="relative flex-1 overflow-hidden rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Progress bar background */}
              <div
                className="absolute inset-0 bg-emerald-400/30 transition-all duration-1000 ease-linear"
                style={{ width: `${timer.percent}%` }}
              />
              <span className="relative z-10">
                {actionsDisabled ? 'Updating...' : `Accept · ${timer.label}`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onReject(order.id)}
              disabled={actionsDisabled}
              className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-all hover:bg-red-500/20 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reject
            </button>
          </>
        )}
        {isAccepted && (
          <button
            type="button"
            onClick={() => onReady(order.id)}
            disabled={actionsDisabled}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400 hover:shadow-amber-500/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionsDisabled ? 'Updating...' : 'Mark Ready'}
          </button>
        )}
        {isReady && (
          <button
            type="button"
            onClick={() => onComplete(order.id)}
            disabled={actionsDisabled}
            className="flex-1 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 hover:shadow-green-500/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionsDisabled ? 'Updating...' : 'Complete'}
          </button>
        )}
      </div>
    </motion.div>
  )
}

/* ─── Section Header ─── */
function SectionHeader({
  icon,
  title,
  count,
  color,
}: {
  icon: string
  title: string
  count: number
  color: string
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-lg">{icon}</span>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {count > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}
        >
          {count}
        </span>
      )}
    </div>
  )
}

/* ─── Main Page ─── */
export default function AdminOrdersPage() {
  const { session, isLoaded: isSessionLoaded } = useSession()
  const supabase = useClerkSupabaseClient()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const selectedBranchIdRef = useRef('')
  selectedBranchIdRef.current = selectedBranchId
  // The set of stores this user is allowed to see (their own branch(es), or
  // every branch for an owner). Used to keep realtime events isolated per store.
  const branchesRef = useRef<{ id: string; name: string }[]>([])
  const branchNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const b of branches) map[b.id] = b.name
    return map
  }, [branches])

  // Whether a given order should appear in this user's feed, given the active
  // store filter and the set of stores they're allowed to see.
  const isOrderVisible = useCallback((branchId: string | null | undefined) => {
    const filter = selectedBranchIdRef.current
    if (filter) return branchId === filter
    const allowed = branchesRef.current
    // Single-store mode (no branches configured): show everything.
    if (allowed.length === 0) return true
    // Multi-branch: only show orders from a store this user can access.
    // Unassigned (legacy, null-branch) orders are left visible.
    if (!branchId) return true
    return allowed.some((b) => b.id === branchId)
  }, [])
  const [pendingStatusByOrderId, setPendingStatusByOrderId] = useState<
    Record<string, OrderRecord['status']>
  >({})
  const [bannerText, setBannerText] = useState('')
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [soundUnlocked, setSoundUnlocked] = useState(false)
  const [showPreviousOrders, setShowPreviousOrders] = useState(false)
  const [expandedPreviousId, setExpandedPreviousId] = useState<string | null>(null)
  const alertAudioRef = useRef<HTMLAudioElement | null>(null)
  const soundEnabledRef = useRef(false)
  const seenOrderIdsRef = useRef<Set<string>>(new Set())
  const hasInitialOrderLoadRef = useRef(false)
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ordersRef = useRef<OrderRecord[]>([])
  const pendingStatusByOrderIdRef = useRef<Record<string, OrderRecord['status']>>({})
  ordersRef.current = orders

  const setPendingOrderStatus = useCallback(
    (orderId: string, status: OrderRecord['status'] | null) => {
      const prev = pendingStatusByOrderIdRef.current
      if (!status) {
        if (!prev[orderId]) return
        const next = { ...prev }
        delete next[orderId]
        pendingStatusByOrderIdRef.current = next
        setPendingStatusByOrderId(next)
        return
      }

      if (prev[orderId] === status) return
      const next = { ...prev, [orderId]: status }
      pendingStatusByOrderIdRef.current = next
      setPendingStatusByOrderId(next)
    },
    []
  )

  /* ── Sound helpers ── */
  function stopAlertSound() {
    const audio = alertAudioRef.current
    if (!audio) return
    audio.pause()
    try { audio.currentTime = 0 } catch { /* noop */ }
    audio.loop = false
  }

  async function enableAlertSoundFromGesture() {
    const audio = alertAudioRef.current
    if (!audio || soundEnabledRef.current) return
    try {
      audio.muted = true
      audio.loop = false
      audio.currentTime = 0
      await audio.play()
      audio.pause()
      audio.currentTime = 0
      audio.muted = false
      soundEnabledRef.current = true
      setSoundUnlocked(true)
      // If there are pending placed orders, start playing now that audio is unlocked
      const hasPlaced = ordersRef.current.some((o) => o.status === 'placed')
      if (hasPlaced) {
        playNewOrderSound().catch(() => { })
      }
    } catch {
      audio.muted = false
    }
  }

  async function playNewOrderSound() {
    const audio = alertAudioRef.current
    if (!audio) return
    stopAlertSound()
    audio.muted = false
    audio.loop = true
    audio.currentTime = 0
    try {
      await audio.play()
      soundEnabledRef.current = true
      setSoundUnlocked(true)
    } catch {
      // Sound blocked — the Enable Sound button will handle it
    }
  }

  // Start or stop sound based on whether placed orders exist
  const syncSoundWithOrders = useCallback(
    (currentOrders: OrderRecord[]) => {
      const hasNew = currentOrders.some((o) => o.status === 'placed')
      if (!hasNew) {
        stopAlertSound()
      } else if (soundEnabledRef.current) {
        // If sound is enabled and there are placed orders, make sure sound is playing
        const audio = alertAudioRef.current
        if (audio && audio.paused) {
          playNewOrderSound().catch(() => { })
        }
      }
    },
    []
  )

  function notifyNewOrders(count: number) {
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current)
      bannerTimeoutRef.current = null
    }
    setBannerText(count > 1 ? `${count} new orders received` : 'New order received!')
    bannerTimeoutRef.current = setTimeout(() => {
      setBannerText('')
      bannerTimeoutRef.current = null
    }, 4000)
    playNewOrderSound().catch(() => { })
  }

  /* ── Fetch orders ── */
  async function fetchOrders(options?: { initial?: boolean }) {
    const branchQuery = selectedBranchIdRef.current
      ? `?branchId=${encodeURIComponent(selectedBranchIdRef.current)}`
      : ''
    const response = await fetch(`/api/admin/orders${branchQuery}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to fetch orders')
    const payload = await response.json()
    const nextOrdersFromServer = (payload.orders || []) as OrderRecord[]
    const pendingMap = pendingStatusByOrderIdRef.current
    const confirmedPendingIds: string[] = []

    const nextOrders = nextOrdersFromServer.map((order) => {
      const pendingStatus = pendingMap[order.id]
      if (!pendingStatus) return order

      if (order.status === pendingStatus) {
        confirmedPendingIds.push(order.id)
        return order
      }

      // Keep optimistic state until backend catches up to avoid UI flicker/revert.
      return { ...order, status: pendingStatus }
    })

    if (confirmedPendingIds.length > 0) {
      setPendingStatusByOrderId((prev) => {
        let changed = false
        const next = { ...prev }
        for (const orderId of confirmedPendingIds) {
          if (next[orderId]) {
            delete next[orderId]
            changed = true
          }
        }
        if (!changed) return prev
        pendingStatusByOrderIdRef.current = next
        return next
      })
    }

    setOrders(nextOrders)
    syncSoundWithOrders(nextOrders)

    const nextPlacedIds = new Set(
      nextOrders
        .filter((o) => o.status === 'placed')
        .map((o) => o.id)
        .filter((id): id is string => Boolean(id))
    )

    if (options?.initial || !hasInitialOrderLoadRef.current) {
      seenOrderIdsRef.current = nextPlacedIds
      hasInitialOrderLoadRef.current = true
      // Play sound if there are already-placed orders on initial load
      if (nextOrders.some((o) => o.status === 'placed')) {
        playNewOrderSound().catch(() => { })
      }
      return
    }

    let newCount = 0
    for (const id of nextPlacedIds) {
      if (!seenOrderIdsRef.current.has(id)) newCount += 1
    }
    seenOrderIdsRef.current = nextPlacedIds
    if (newCount > 0) notifyNewOrders(newCount)
  }

  /* ── Realtime helpers (incremental, socket-driven) ── */

  // Fetch one order (with items + product) — used to hydrate INSERT events,
  // whose realtime payload does not include joined order_items.
  async function fetchSingleOrder(id: string): Promise<OrderRecord | null> {
    try {
      const res = await fetch(`/api/admin/orders/${id}`, { cache: 'no-store' })
      if (!res.ok) return null
      const payload = await res.json()
      return (payload.order || null) as OrderRecord | null
    } catch {
      return null
    }
  }

  // Insert or merge a single order into local state, keeping newest first.
  function upsertOrderInState(order: OrderRecord) {
    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === order.id)
      let next: OrderRecord[]
      if (idx === -1) {
        next = [order, ...prev]
      } else {
        next = [...prev]
        next[idx] = {
          ...prev[idx],
          ...order,
          // realtime row payloads omit joins — keep existing items if absent
          order_items: order.order_items ?? prev[idx].order_items ?? [],
        }
      }
      next.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      syncSoundWithOrders(next)
      return next
    })

    // Reconcile optimistic state once the server's value matches.
    const pending = pendingStatusByOrderIdRef.current[order.id]
    if (pending && order.status === pending) {
      setPendingOrderStatus(order.id, null)
    }
  }

  function removeOrderFromState(id: string) {
    setOrders((prev) => {
      const next = prev.filter((o) => o.id !== id)
      syncSoundWithOrders(next)
      return next
    })
    seenOrderIdsRef.current.delete(id)
    setPendingOrderStatus(id, null)
  }

  // Apply a single postgres_changes event to local state.
  async function handleRealtimeEvent(payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Partial<OrderRecord> | null
    old: Partial<OrderRecord> | null
  }) {
    if (payload.eventType === 'DELETE') {
      if (payload.old?.id) removeOrderFromState(payload.old.id)
      return
    }

    const row = payload.new
    if (!row?.id) return

    // Keep stores isolated: ignore live events for orders this user shouldn't
    // see (other branches) or that the active store filter excludes.
    if (!isOrderVisible(row.branch_id)) return

    if (payload.eventType === 'INSERT') {
      const full = (await fetchSingleOrder(row.id)) || (row as OrderRecord)
      const isUnseenPlaced =
        full.status === 'placed' && !seenOrderIdsRef.current.has(full.id)
      upsertOrderInState(full)
      if (isUnseenPlaced) {
        seenOrderIdsRef.current.add(full.id)
        notifyNewOrders(1)
      }
      return
    }

    // UPDATE — patch in place; hydrate from server if we don't have it yet.
    const exists = ordersRef.current.some((o) => o.id === row.id)
    if (exists) {
      upsertOrderInState(row as OrderRecord)
    } else {
      const full = (await fetchSingleOrder(row.id)) || (row as OrderRecord)
      upsertOrderInState(full)
    }
    if (row.status === 'placed') seenOrderIdsRef.current.add(row.id)
    else seenOrderIdsRef.current.delete(row.id)
  }

  /* ── Audio setup ── */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const audio = new Audio('/sounds/a.wav')
    audio.preload = 'auto'
    alertAudioRef.current = audio
    return () => {
      stopAlertSound()
      alertAudioRef.current = null
    }
  }, [])

  /* ── Unlock audio on first gesture ── */
  useEffect(() => {
    const handler = () => enableAlertSoundFromGesture().catch(() => { })
    window.addEventListener('pointerdown', handler, { passive: true })
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [])

  /* ── Initial load (one full fetch via the Clerk-protected admin API) ── */
  useEffect(() => {
    fetchOrders({ initial: true }).catch(() => { })
    return () => {
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current)
      stopAlertSound()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Load the stores this user can see (for the store filter) ── */
  useEffect(() => {
    fetch('/api/branches?all=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const list = ((d.branches || []) as { id: string; name: string }[]).map((b) => ({
          id: b.id,
          name: b.name,
        }))
        branchesRef.current = list
        setBranches(list)
      })
      .catch(() => {})
  }, [])

  /* ── Refetch when the store filter changes ── */
  useEffect(() => {
    // Reset the seen-set so the new branch's existing orders don't trigger
    // "new order" alerts, then reload scoped to the selected store.
    hasInitialOrderLoadRef.current = false
    fetchOrders({ initial: true }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  /* ── Realtime socket subscription (authenticated, no polling) ── */
  const hasSession = Boolean(session)
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return
    // Wait for the Clerk session so the socket connects with the admin's
    // identity; RLS only streams `orders` to an authenticated admin.
    if (!isSessionLoaded || !hasSession) return

    let disposed = false
    let channel: RealtimeChannel | null = null
    let consecutiveFailures = 0
    let recreateTimer: number | null = null

    // Build (or rebuild) the channel. A channel instance whose joins keep
    // getting rejected can wedge inside realtime-js; after a few consecutive
    // failures we tear it down and start a fresh one with a fresh token.
    const createChannel = () => {
      if (disposed) return
      if (channel) supabase.removeChannel(channel)
      channel = supabase
        .channel('admin-orders-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders' },
          (payload) => {
            handleRealtimeEvent(
              payload as unknown as Parameters<typeof handleRealtimeEvent>[0]
            ).catch(() => { })
          }
        )
        .subscribe((status, err) => {
          if (disposed) return
          if (status === 'SUBSCRIBED') {
            consecutiveFailures = 0
            setLiveStatus('live')
            // Fires on first connect and again whenever the socket re-subscribes
            // after a drop. Reconcile against the server once on (re)connect so
            // we never miss events that fired while disconnected. Event-driven
            // recovery, not periodic polling.
            if (hasInitialOrderLoadRef.current) fetchOrders().catch(() => { })
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Surface WHY the join failed — this distinguishes a config problem
            // (rejected token, table missing from the supabase_realtime
            // publication) from a transient network drop.
            console.error(
              '[orders-realtime] channel', status,
              err instanceof Error ? err.message : err ?? '(no error detail)'
            )
            setLiveStatus('reconnecting')
            consecutiveFailures += 1
            if (consecutiveFailures >= 3 && recreateTimer === null) {
              consecutiveFailures = 0
              recreateTimer = window.setTimeout(() => {
                recreateTimer = null
                refreshSocketAuth().then(() => createChannel()).catch(() => { })
              }, 2000)
            }
          } else if (status === 'CLOSED') {
            setLiveStatus('connecting')
          }
        })
    }

    // ── "Always-on" watchdog ───────────────────────────────────
    // Kitchen tablets sleep, wifi drops, and the tab gets backgrounded
    // (which throttles timers and can silently kill the socket). When the
    // page wakes / regains network / refocuses, force the socket + channel
    // back up and resync so the feed is never stale. Also a lightweight
    // periodic liveness check as a final safety net.
    // Push a FRESH Clerk token to the realtime socket. setAuth() with no args
    // re-invokes the client's accessToken callback (which reads the latest
    // Clerk session), so this both refreshes before expiry and re-authorizes
    // joined channels. Without this, a dropped channel rejoins with an expired
    // token and stays stuck on "Reconnecting".
    const refreshSocketAuth = async () => {
      try {
        await supabase.realtime.setAuth()
      } catch {
        /* noop */
      }
    }

    const ensureLive = async (resync = false) => {
      const ch = channel
      if (!ch) return
      const socketDown = !supabase.realtime.isConnected()
      const channelDown = ch.state !== 'joined' && ch.state !== 'joining'
      // Always hand the socket a fresh token before (re)connecting.
      if (socketDown || channelDown) await refreshSocketAuth()
      if (socketDown) supabase.realtime.connect()
      if (channelDown) {
        setLiveStatus('reconnecting')
        if (ch.state === 'closed') {
          // A cleanly-closed channel can be rejoined in place.
          ch.subscribe()
        } else {
          // 'errored'/'leaving' instances can't be re-subscribed — rebuild.
          createChannel()
        }
      }
      // Resync ONLY on an explicit wake/online/focus event, or when we just had
      // to recover a dead connection. A healthy socket triggers no fetch — so
      // the periodic check below never degrades into polling.
      if ((resync || socketDown || channelDown) && hasInitialOrderLoadRef.current) {
        fetchOrders().catch(() => { })
      }
    }

    // Initial connect — with a fresh token already applied to the socket.
    refreshSocketAuth().then(() => createChannel()).catch(() => createChannel())

    const wake = () => { ensureLive(true).catch(() => {}) } // event-driven catch-up
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', onVisible)
    // Liveness watchdog: only reconnects if the socket/channel is actually
    // down; does nothing (no fetch) while healthy.
    const liveness = window.setInterval(() => {
      if (document.visibilityState === 'visible') ensureLive(false).catch(() => {})
    }, 20000)
    // Proactive token refresh — keep the socket authorized ahead of the
    // short-lived Clerk token's expiry so it never drops in the first place.
    const authRefresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshSocketAuth()
    }, 40000)

    return () => {
      disposed = true
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(liveness)
      window.clearInterval(authRefresh)
      if (recreateTimer !== null) window.clearTimeout(recreateTimer)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, isSessionLoaded, hasSession])

  /* ── Safety net: poll while the socket is NOT live ──────────────
     Realtime is the primary transport, but if the channel can't connect
     (auth/config problem, hostile network, captive portal wifi) the kitchen
     must still receive orders. This interval runs ONLY while the badge is
     not "live" and stops the moment the socket connects — so a healthy
     panel never polls. New orders found this way still trigger the sound
     alert via fetchOrders(). */
  useEffect(() => {
    if (liveStatus === 'live') return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && hasInitialOrderLoadRef.current) {
        fetchOrders().catch(() => { })
      }
    }, 12000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus])

  /* ── Status actions ── */
  async function updateStatus(id: string, status: OrderRecord['status']) {
    if (pendingStatusByOrderIdRef.current[id]) return

    setPendingOrderStatus(id, status)

    // Optimistic update
    setOrders((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, status: status as OrderRecord['status'] } : o))
      syncSoundWithOrders(next)
      return next
    })

    try {
      const response = await fetch('/api/admin/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })

      if (!response.ok) {
        throw new Error('Status update failed')
      }
    } catch {
      // Revert the optimistic change for just this order.
      setPendingOrderStatus(id, null)
      const fresh = await fetchSingleOrder(id)
      if (fresh) upsertOrderInState(fresh)
      return
    }

    // Success: the realtime UPDATE echo confirms the change and clears the
    // pending/optimistic flag in upsertOrderInState — no refetch needed.
  }

  const acceptOrder = (id: string) => updateStatus(id, 'preparing')
  const rejectOrder = (id: string) => {
    if (window.confirm('Reject this order?')) updateStatus(id, 'cancelled')
  }
  const markReady = (id: string) => updateStatus(id, 'out_for_delivery')
  const completeOrder = (id: string) => updateStatus(id, 'delivered')

  /* ── Categorize orders ── */
  const newOrders = useMemo(
    () => orders.filter((o) => o.status === 'placed'),
    [orders]
  )
  const acceptedOrders = useMemo(
    () => orders.filter((o) => o.status === 'preparing'),
    [orders]
  )
  const readyOrders = useMemo(
    () => orders.filter((o) => o.status === 'out_for_delivery'),
    [orders]
  )
  const completedOrders = useMemo(() => {
    const todayStr = new Date().toLocaleDateString()
    return orders.filter(
      (o) =>
        (o.status === 'delivered' || o.status === 'cancelled') &&
        o.created_at &&
        new Date(o.created_at).toLocaleDateString() === todayStr
    )
  }, [orders])
  const activeCount = newOrders.length + acceptedOrders.length + readyOrders.length

  return (
    <div className="pb-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Orders</h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${liveStatus === 'live'
                ? 'bg-emerald-500/15 text-emerald-400'
                : liveStatus === 'reconnecting'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-gray-500/15 text-gray-400'
                }`}
              title="Realtime connection status"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${liveStatus === 'live'
                  ? 'bg-emerald-400'
                  : liveStatus === 'reconnecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-gray-400 animate-pulse'
                  }`}
              />
              {liveStatus === 'live' ? 'Live' : liveStatus === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {activeCount} active · {completedOrders.length} completed today
          </p>
        </div>
        <div className="flex items-center gap-3">
          {branches.length > 1 && (
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#222] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              title="Filter orders by store"
            >
              <option value="">All stores</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <PushAlertsButton />
          {newOrders.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="text-xs font-medium text-red-400">
                {newOrders.length} new
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Enable Sound button — shown when sound is blocked and there are new orders */}
      {!soundUnlocked && newOrders.length > 0 && (
        <button
          type="button"
          onClick={() => enableAlertSoundFromGesture().catch(() => { })}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.98]"
        >
          <span className="text-lg">🔊</span>
          Enable Sound Alerts
        </button>
      )}

      {/* Banner */}
      <AnimatePresence>
        {bannerText && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300"
          >
            {bannerText}
          </motion.div>
        )}
      </AnimatePresence>

      {activeCount === 0 && orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-4xl">🍽️</p>
          <p className="mt-3 text-sm text-gray-500">No orders yet</p>
          <p className="mt-1 text-xs text-gray-600">New orders will appear here with a sound alert</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ─── 🔴 New Orders ─── */}
          {newOrders.length > 0 && (
            <section>
              <SectionHeader
                icon="🔴"
                title="New Orders"
                count={newOrders.length}
                color="bg-red-500/15 text-red-400"
              />
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {newOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onAccept={acceptOrder}
                      onReject={rejectOrder}
                      onReady={markReady}
                      onComplete={completeOrder}
                      isUpdating={Boolean(pendingStatusByOrderId[order.id])}
                      branchName={order.branch_id ? branchNameById[order.branch_id] : undefined}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* ─── 🟡 Accepted Orders ─── */}
          {acceptedOrders.length > 0 && (
            <section>
              <SectionHeader
                icon="🟡"
                title="Accepted"
                count={acceptedOrders.length}
                color="bg-amber-500/15 text-amber-400"
              />
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {acceptedOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onAccept={acceptOrder}
                      onReject={rejectOrder}
                      onReady={markReady}
                      onComplete={completeOrder}
                      isUpdating={Boolean(pendingStatusByOrderId[order.id])}
                      branchName={order.branch_id ? branchNameById[order.branch_id] : undefined}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* ─── 🟢 Ready Orders ─── */}
          {readyOrders.length > 0 && (
            <section>
              <SectionHeader
                icon="🟢"
                title="Ready"
                count={readyOrders.length}
                color="bg-green-500/15 text-green-400"
              />
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {readyOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onAccept={acceptOrder}
                      onReject={rejectOrder}
                      onReady={markReady}
                      onComplete={completeOrder}
                      isUpdating={Boolean(pendingStatusByOrderId[order.id])}
                      branchName={order.branch_id ? branchNameById[order.branch_id] : undefined}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* ─── Empty active state ─── */}
          {activeCount === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-3xl">✅</p>
              <p className="mt-2 text-sm text-gray-500">All orders handled</p>
              <p className="mt-1 text-xs text-gray-600">
                {completedOrders.length} order{completedOrders.length !== 1 ? 's' : ''} completed
              </p>
            </div>
          )}

          {/* ─── 📋 Previous Orders (today) ─── */}
          {completedOrders.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowPreviousOrders((v) => !v)}
                className="mb-3 flex w-full items-center gap-2 text-left"
              >
                <span className="text-lg">📋</span>
                <h3 className="text-sm font-semibold text-white">Previous Orders</h3>
                <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                  {completedOrders.length}
                </span>
                <span className="ml-auto text-xs text-gray-500">
                  {showPreviousOrders ? '▲ Hide' : '▼ Show'}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {showPreviousOrders && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3">
                      {completedOrders.map((order) => {
                        const meta = parseOrderMeta(order.instructions)
                        const cleanInstructions = stripOrderMeta(order.instructions)
                        const items = (order.order_items || []) as OrderItemRecord[]
                        const itemCount = items.reduce((s, i) => s + Number(i.qty || 0), 0)
                        const isCancelled = order.status === 'cancelled'
                        const isDetailOpen = expandedPreviousId === order.id

                        return (
                          <div
                            key={order.id}
                            className={`rounded-2xl border p-4 cursor-pointer transition-colors ${isCancelled
                              ? 'border-red-500/15 bg-red-500/5 opacity-60'
                              : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                              }`}
                            onClick={() => setExpandedPreviousId(isDetailOpen ? null : order.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-white">
                                    #{order.id?.slice(0, 8)}
                                  </p>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isCancelled
                                      ? 'bg-red-500/15 text-red-400'
                                      : 'bg-green-500/15 text-green-400'
                                      }`}
                                  >
                                    {isCancelled ? 'Cancelled' : 'Completed'}
                                  </span>
                                  <span className="text-[11px] text-gray-600">
                                    {isDetailOpen ? '▲' : '▼'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                  {meta.orderType === 'pickup' ? '📦 Pickup' : '🚚 Delivery'}
                                  {' · '}{itemCount} item{itemCount !== 1 ? 's' : ''}
                                  {' · '}{order.phone || 'No phone'}
                                  {' · '}{order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                  {order.branch_id && branchNameById[order.branch_id]
                                    ? ` · 🏬 ${branchNameById[order.branch_id]}`
                                    : ''}
                                </p>
                              </div>
                              <p className="text-sm font-bold text-white">{formatMoney(order.total)}</p>
                            </div>

                            <AnimatePresence initial={false}>
                              {isDetailOpen && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                                    {/* Items */}
                                    <div className="rounded-xl bg-white/5 p-3">
                                      <p className="mb-2 text-[11px] font-semibold text-gray-400">Items</p>
                                      <div className="space-y-1.5">
                                        {items.map((item) => {
                                          const name = item.product?.name || `Item ${String(item.product_id).slice(0, 6)}`
                                          return (
                                            <div key={item.id} className="flex justify-between text-xs">
                                              <span className="text-gray-300">
                                                {item.product?.is_veg ? '🟢' : '🔴'} {name} ×{item.qty}
                                                {item.addons?.length ? (
                                                  <span className="text-gray-500">
                                                    {' '}(+{item.addons.map((a) => a.name).join(', ')})
                                                  </span>
                                                ) : null}
                                              </span>
                                              <span className="text-gray-400">{formatMoney(Number(item.price || 0) * Number(item.qty || 0))}</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>

                                    {/* Bill */}
                                    <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-300">
                                      <div className="space-y-1">
                                        <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(order.subtotal)}</span></div>
                                        {Number(order.discount) > 0 && (
                                          <div className="flex justify-between text-green-400"><span>Discount</span><span>-{formatMoney(order.discount)}</span></div>
                                        )}
                                        <div className="flex justify-between"><span>Tax</span><span>{formatMoney(order.tax)}</span></div>
                                        <div className="flex justify-between"><span>Packing</span><span>{formatMoney(order.packing_fee)}</span></div>
                                        <div className="flex justify-between border-t border-white/10 pt-1 font-semibold text-white">
                                          <span>Total</span><span>{formatMoney(order.total)}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Address */}
                                    {meta.orderType !== 'pickup' && order.address && (
                                      <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-400">
                                        <span className="text-gray-500">📍 </span>{order.address}
                                      </div>
                                    )}

                                    {/* Pickup info */}
                                    {meta.orderType === 'pickup' && meta.pickupCode && (
                                      <div className="rounded-xl bg-white/5 p-3 text-xs text-emerald-400">
                                        Code: {meta.pickupCode}
                                        {meta.pickupSlot ? ` · Pickup: ${new Date(meta.pickupSlot).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                                      </div>
                                    )}

                                    {/* Notes */}
                                    {cleanInstructions && (
                                      <div className="rounded-xl bg-white/5 p-3 text-xs text-gray-400">
                                        <span className="text-gray-500">📝 </span>{cleanInstructions}
                                      </div>
                                    )}

                                    {/* Payment */}
                                    <div className="text-[11px] text-gray-500">
                                      {order.payment_method || 'razorpay'} · {order.payment_status || 'pending'}
                                      {order.coupon_code ? ` · Coupon: ${order.coupon_code}` : ''}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}
        </div>
      )}

    </div>
  )
}
