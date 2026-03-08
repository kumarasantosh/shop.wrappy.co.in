'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import OrderTracker from '../../components/OrderTracker'
import { parseOrderMeta, stripOrderMeta } from '../../lib/orderMeta'
import supabase from '../../lib/supabase'
import { OrderRecord } from '../../lib/types'

function formatMoney(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return '₹0'
  const hasDecimals = Math.abs(numeric % 1) > 0.000001
  return `₹${numeric.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

export default function OrdersPage() {
  const { user } = useUser()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  async function loadOrders() {
    setLoading(true)
    try {
      const response = await fetch('/api/orders')
      const payload = await response.json()
      setOrders((payload.orders || []) as OrderRecord[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders().catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!user?.id) return
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return

    const channel = supabase
      .channel(`orders-realtime-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `customer_clerk_id=eq.${user.id}`,
        },
        () => {
          loadOrders().catch(() => { })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const activeOrderCount = useMemo(
    () =>
      orders.filter(
        (order) => order.status !== 'delivered' && order.status !== 'cancelled'
      ).length,
    [orders]
  )
  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  )
  const selectedOrderMeta = useMemo(
    () => (selectedOrder ? parseOrderMeta(selectedOrder.instructions) : null),
    [selectedOrder]
  )
  const selectedOrderItems = useMemo(
    () => selectedOrder?.order_items || [],
    [selectedOrder]
  )
  const selectedOrderNotes = useMemo(
    () => stripOrderMeta(selectedOrder?.instructions),
    [selectedOrder]
  )

  useEffect(() => {
    if (!selectedOrderId) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedOrderId(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedOrderId])

  useEffect(() => {
    if (!selectedOrderId) return
    if (!orders.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId(null)
    }
  }, [orders, selectedOrderId])

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your Orders</h1>
        <p className="rounded-full border border-white/10 bg-[#181818] px-3 py-1 text-xs text-gray-300">
          Active: {activeOrderCount}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl bg-[#181818]"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-20 text-center">
          <p className="mb-4 text-5xl">📦</p>
          <h2 className="mb-2 text-xl font-semibold">No orders yet</h2>
          <p className="text-gray-500">Your order history will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const meta = parseOrderMeta(order.instructions)

            return (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrderId(order.id)}
                className="w-full text-left"
              >
                <div className="space-y-3">
                  {meta.orderType === 'pickup' ? (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
                      <p className="font-semibold text-emerald-300">Self Pickup</p>
                      {meta.pickupSlot ? (
                        <p className="mt-1 text-emerald-200">
                          Slot:{' '}
                          {new Date(meta.pickupSlot).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      ) : null}
                      {meta.pickupCode ? (
                        <p className="mt-1 text-emerald-100">
                          Verification Code:{' '}
                          <span className="font-bold tracking-wide">{meta.pickupCode}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <OrderTracker
                    orderId={order.id}
                    status={order.status}
                    eta={order.eta}
                    createdAt={order.created_at}
                    total={Number(order.total)}
                    orderType={meta.orderType}
                  />
                  <p className="px-1 text-xs text-gray-500">Tap to view complete details</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Close details"
            onClick={() => setSelectedOrderId(null)}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          <div className="relative z-10 w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#141414] p-6 sm:max-h-[90vh] sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Order Details</h3>
                <p className="text-xs text-gray-500">#{selectedOrder.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="rounded-lg border border-white/10 bg-[#222] px-3 py-1.5 text-xs text-white"
              >
                Close
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-4 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-[#222] px-2.5 py-1 text-xs text-white">
                  {selectedOrder.status.replaceAll('_', ' ')}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${selectedOrderMeta?.orderType === 'pickup'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-blue-500/15 text-blue-300'
                    }`}
                >
                  {selectedOrderMeta?.orderType === 'pickup' ? 'Self Pickup' : 'Delivery'}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Placed on {new Date(selectedOrder.created_at).toLocaleString()}
              </p>
              {selectedOrder.eta ? (
                <p className="mt-1 text-xs text-gray-500">
                  ETA {new Date(selectedOrder.eta).toLocaleString()}
                </p>
              ) : null}
            </div>

            <div className="mb-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
              <p className="mb-3 text-sm font-semibold text-white">Items</p>
              <div className="space-y-3">
                {selectedOrderItems.length > 0 ? (
                  selectedOrderItems.map((item) => {
                    const itemName =
                      item.product?.name || `Item ${String(item.product_id).slice(0, 8)}`
                    const qty = Number(item.qty || 0)
                    const price = Number(item.price || 0)
                    const lineTotal = Number(
                      item.line_total ?? qty * price
                    )

                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-white/10 bg-[#222] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{itemName}</p>
                            <p className="text-xs text-gray-500">
                              {qty} × {formatMoney(price)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-white">
                            {formatMoney(lineTotal)}
                          </p>
                        </div>
                        {item.addons?.length ? (
                          <div className="mt-2 space-y-1">
                            {item.addons.map((addon) => (
                              <p key={addon.id} className="text-xs text-gray-400">
                                + {addon.name} ({formatMoney(addon.price)})
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <p className="text-xs text-gray-500">No order items found.</p>
                )}
              </div>
            </div>

            <div className="mb-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-4 text-sm">
              <p className="mb-2 font-semibold text-white">Delivery / Pickup</p>
              {selectedOrderMeta?.orderType === 'pickup' ? (
                <div className="space-y-1 text-gray-300">
                  <p>Self Pickup at Store</p>
                  {selectedOrderMeta.pickupSlot ? (
                    <p>
                      Pickup Slot:{' '}
                      {new Date(selectedOrderMeta.pickupSlot).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  ) : null}
                  {selectedOrderMeta.pickupCode ? (
                    <p>
                      Verification Code:{' '}
                      <span className="font-semibold text-emerald-300">
                        {selectedOrderMeta.pickupCode}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-gray-300">{selectedOrder.address || 'No delivery address'}</p>
              )}
              <p className="mt-2 text-gray-300">Phone: {selectedOrder.phone || 'N/A'}</p>
              {selectedOrderNotes ? (
                <p className="mt-1 text-gray-300">Notes: {selectedOrderNotes}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4 text-sm">
              <p className="mb-2 font-semibold text-white">Bill Details</p>
              <div className="space-y-1.5 text-gray-300">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatMoney(selectedOrder.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>-{formatMoney(selectedOrder.discount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>{formatMoney(selectedOrder.tax)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Packing</span>
                  <span>{formatMoney(selectedOrder.packing_fee)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-white">
                  <span>Total</span>
                  <span className="font-semibold">{formatMoney(selectedOrder.total)}</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Payment: {selectedOrder.payment_method || 'razorpay'} •{' '}
                  {selectedOrder.payment_status || 'pending'}
                </div>
                {selectedOrder.coupon_code ? (
                  <div className="text-xs text-gray-500">
                    Coupon: {selectedOrder.coupon_code}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
