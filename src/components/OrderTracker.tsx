'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { OrderStatus } from '../lib/types'

type OrderType = 'delivery' | 'pickup'

const DELIVERY_STEPS = [
  { label: 'Order Placed', value: 'placed' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Out for Delivery', value: 'out_for_delivery' },
  { label: 'Delivered', value: 'delivered' },
]

const PICKUP_STEPS = [
  { label: 'Order Placed', value: 'placed' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Ready for Pickup', value: 'out_for_delivery' },
]

function statusToStep(status: OrderStatus, isPickup: boolean) {
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS
  const index = steps.findIndex((s) => s.value === status)
  if (index >= 0) return index
  if (status === 'delivered' && isPickup) return PICKUP_STEPS.length - 1
  if (status === 'cancelled') return 0
  return 0
}

function formatCountdown(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

export default function OrderTracker({
  orderId,
  status,
  eta,
  createdAt,
  total,
  orderType = 'delivery',
}: {
  orderId: string
  status: OrderStatus
  eta: string | null
  createdAt: string
  total: number
  orderType?: OrderType
}) {
  const isPickup = orderType === 'pickup'
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS
  const step = statusToStep(status, isPickup)
  const isComplete = isPickup
    ? status === 'out_for_delivery' || status === 'delivered'
    : status === 'delivered'
  const isCancelled = status === 'cancelled'

  const [etaTime, setEtaTime] = useState(() =>
    eta ? new Date(eta).getTime() : Date.now() + 30 * 60_000
  )
  const [delayBumps, setDelayBumps] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  useEffect(() => {
    setEtaTime(eta ? new Date(eta).getTime() : Date.now() + 30 * 60_000)
    setDelayBumps(0)
  }, [eta])

  useEffect(() => {
    const computeRemaining = () =>
      Math.max(0, Math.floor((etaTime - Date.now()) / 1000))
    setRemainingSeconds(computeRemaining())

    if (isComplete || isCancelled) return

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev > 0) return prev - 1

        setDelayBumps((count) => count + 1)
        setEtaTime((current) => current + 5 * 60_000)
        return 5 * 60
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [etaTime, status, isComplete, isCancelled])

  const progress = step / (steps.length - 1)

  const statusLabel = isCancelled
    ? 'Cancelled'
    : isComplete
      ? isPickup
        ? 'Ready for Pickup'
        : 'Delivered'
      : steps[step]?.label

  const etaMessage = useMemo(() => {
    if (isComplete) return isPickup ? 'Ready for Pickup' : 'Delivered'
    if (isCancelled) return 'Cancelled'
    if (delayBumps > 0) {
      return `Running late by ${delayBumps * 5} min • ${formatCountdown(
        remainingSeconds
      )} left`
    }
    return isPickup
      ? `Ready in ${formatCountdown(remainingSeconds)}`
      : `ETA ${formatCountdown(remainingSeconds)}`
  }, [delayBumps, remainingSeconds, status, isPickup, isComplete, isCancelled])

  const trackingIcon = isPickup ? '📦' : '🛵'

  return (
    <div className="rounded-2xl border border-white/10 bg-[#181818] p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Order #{orderId.slice(0, 8)}
          </p>
          <p className="mt-1 text-lg font-semibold">{etaMessage}</p>
          <p className="mt-1 text-xs text-gray-500">
            Placed on {new Date(createdAt).toLocaleString()} • ₹{total}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${isComplete
              ? 'bg-green-500/10 text-green-400'
              : isCancelled
                ? 'bg-red-500/10 text-red-400'
                : 'bg-yellow-500/10 text-yellow-300'
            }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="relative mb-3 h-2 rounded-full bg-[#2b2b2b]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-white"
          initial={{ width: '0%' }}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -top-6 text-2xl"
          initial={{ left: '0%' }}
          animate={{ left: `${progress * 100}%` }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          style={{ transform: 'translateX(-50%)' }}
        >
          {trackingIcon}
        </motion.div>
      </div>

      <div className={`mt-6 grid gap-2`} style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((entry, index) => (
          <div key={entry.label} className="text-center">
            <p
              className={`text-xs ${index <= step ? 'font-semibold text-white' : 'text-gray-600'
                }`}
            >
              {entry.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
