'use client'

/**
 * /delivery — Borzo delivery demo page
 *
 * Flow:
 *  Step 1 — Enter pickup + dropoff details, get a price quote
 *  Step 2 — Confirm price, place the order
 *  Step 3 — Track order status (polls every 10 s; prefer callbacks for production)
 *
 * All Borzo calls go through server-side route handlers (/api/borzo/*),
 * so the auth token is never exposed to the browser.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = {
  address: string
  latitude: string
  longitude: string
  name: string
  phone: string
  note: string
}

type QuoteResult = {
  payment_amount: string | null
  delivery_fee: string | null
  warnings: string[]
  order_preview: Record<string, unknown> | null
}

type OrderResult = {
  order_id: number
  order_name: string
  status: string
  payment_amount: string
  tracking_url: string | null
  tracking_urls: { address: string; url: string }[]
}

type TrackResult = {
  status: string
  status_description: string
  courier: {
    name: string
    phone: string
    photo_url: string | null
    latitude: string | null
    longitude: string | null
  } | null
}

type Step = 'form' | 'quote' | 'order' | 'track'

// ─── Store defaults (pickup is always Wrappy's store) ─────────────────────────

const STORE_PICKUP: Point = {
  address:
    'Plot 192, Addagutta Society - Jal Vayu Vihar Road, near JNTU, Addagutta Society, Kukatpally, Hyderabad',
  latitude: '17.497761893885446',
  longitude: '78.394967441416',
  name: 'Wrappy',
  phone: '9182285342',
  note: 'Pickup from Wrappy store',
}

const EMPTY_POINT: Point = {
  address: '',
  latitude: '',
  longitude: '',
  name: '',
  phone: '',
  note: '',
}

// ─── Status badge colours ─────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  new: 'bg-yellow-500/10 text-yellow-400',
  available: 'bg-blue-500/10 text-blue-400',
  active: 'bg-green-500/10 text-green-400',
  delayed: 'bg-orange-500/10 text-orange-400',
  completed: 'bg-emerald-500/10 text-emerald-400',
  canceled: 'bg-red-500/10 text-red-400',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const [step, setStep] = useState<Step>('form')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Form state
  const [pickup, setPickup] = useState<Point>(STORE_PICKUP)
  const [dropoff, setDropoff] = useState<Point>(EMPTY_POINT)
  const [matter, setMatter] = useState('Food')
  const [weightKg, setWeightKg] = useState('1')

  // Results
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [order, setOrder] = useState<OrderResult | null>(null)
  const [track, setTrack] = useState<TrackResult | null>(null)

  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clearError() {
    setErrorMsg(null)
  }

  async function apiPost(path: string, body: object) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return json
  }

  async function apiGet(path: string) {
    const res = await fetch(path)
    const json = await res.json()
    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return json
  }

  // ── Step 1 → 2: Calculate ─────────────────────────────────────────────────

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    setLoading(true)
    try {
      const result = await apiPost('/api/borzo/calculate-order', {
        pickup,
        dropoffs: [dropoff],
        matter,
        weight_kg: Number(weightKg),
      })
      setQuote(result as QuoteResult)
      setStep('quote')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'calculate failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2 → 3: Create ────────────────────────────────────────────────────

  async function handleCreate() {
    clearError()
    setLoading(true)
    try {
      const result = await apiPost('/api/borzo/create-order', {
        pickup,
        dropoffs: [dropoff],
        matter,
        weight_kg: Number(weightKg),
      })
      setOrder(result as OrderResult)
      setStep('order')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'create failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3 → 4: Track ────────────────────────────────────────────────────

  const pollStatus = useCallback(async (orderId: number) => {
    try {
      const data = await apiGet(`/api/borzo/orders?order_id=${orderId}`)
      const o = (data.orders?.[0] ?? data.order) as TrackResult | undefined
      if (o) {
        setTrack(o as TrackResult)
        // Stop polling on terminal statuses
        if (o.status === 'completed' || o.status === 'canceled') {
          stopPolling()
        }
      }
    } catch {
      // Silent — keep polling
    }
  }, [stopPolling])

  async function handleStartTracking() {
    if (!order) return
    setStep('track')
    await pollStatus(order.order_id)
    pollRef.current = setInterval(() => pollStatus(order.order_id), 10_000)
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async function handleCancel() {
    if (!order) return
    clearError()
    setLoading(true)
    try {
      await apiPost('/api/borzo/cancel-order', { order_id: order.order_id })
      stopPolling()
      setTrack((prev) =>
        prev ? { ...prev, status: 'canceled', status_description: 'Cancelled via API' } : prev
      )
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'cancel failed')
    } finally {
      setLoading(false)
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0F0F0F] text-white py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Borzo Delivery</h1>
          <p className="text-sm text-gray-400 mt-1">
            Calculate → Confirm → Track your delivery
          </p>

          {/* Progress steps */}
          <div className="flex gap-2 mt-4 text-xs">
            {(['form', 'quote', 'order', 'track'] as Step[]).map((s, i) => (
              <div
                key={s}
                className={`px-3 py-1 rounded-full font-medium ${
                  step === s
                    ? 'bg-orange-500 text-white'
                    : 'bg-[#181818] text-gray-400 border border-white/10'
                }`}
              >
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </div>
            ))}
          </div>
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {errorMsg}
          </div>
        )}

        {/* ── STEP 1: Form ─────────────────────────────────────────────── */}
        {step === 'form' && (
          <form onSubmit={handleCalculate} className="space-y-6">
            {/* Pickup */}
            <Section title="Pickup (store)">
              <PointFields
                label="Pickup"
                value={pickup}
                onChange={setPickup}
              />
            </Section>

            {/* Drop-off */}
            <Section title="Customer drop-off">
              <PointFields
                label="Dropoff"
                value={dropoff}
                onChange={setDropoff}
              />
            </Section>

            {/* Order details */}
            <Section title="Order details">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contents (matter)">
                  <input
                    className="input"
                    value={matter}
                    onChange={(e) => setMatter(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Weight (kg)">
                  <input
                    className="delivery-input"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    required
                  />
                </Field>
              </div>
            </Section>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? 'Calculating…' : 'Get Price Quote'}
            </button>
          </form>
        )}

        {/* ── STEP 2: Quote ────────────────────────────────────────────── */}
        {step === 'quote' && quote && (
          <div className="space-y-4">
            <Section title="Delivery quote">
              <div className="space-y-2">
                <PriceLine
                  label="Delivery fee"
                  value={quote.delivery_fee ? `₹${quote.delivery_fee}` : '—'}
                />
                <PriceLine
                  label="Total charge"
                  value={
                    quote.payment_amount
                      ? `₹${quote.payment_amount}`
                      : '—'
                  }
                  bold
                />
              </div>

              {quote.warnings.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-300">
                  <strong>Warnings:</strong>
                  <ul className="list-disc ml-4 mt-1">
                    {quote.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('form')}
                className="flex-1 py-3 border border-white/20 text-white rounded-lg hover:bg-white/10"
              >
                ← Edit details
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50"
              >
                {loading ? 'Placing order…' : 'Confirm & Place Order'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Order placed ─────────────────────────────────────── */}
        {step === 'order' && order && (
          <div className="space-y-4">
            <Section title="Order placed ✓">
              <div className="space-y-2">
                <PriceLine label="Borzo order ID" value={`#${order.order_id}`} />
                <PriceLine label="Order name" value={order.order_name} />
                <PriceLine
                  label="Status"
                  value={
                    <StatusBadge status={order.status} />
                  }
                />
                <PriceLine label="Amount" value={`₹${order.payment_amount}`} bold />
              </div>

              {order.tracking_urls.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Tracking links
                  </p>
                  {order.tracking_urls.map(({ address, url }) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-orange-600 hover:underline truncate"
                    >
                      {address}
                    </a>
                  ))}
                </div>
              )}
            </Section>

            <button
              onClick={handleStartTracking}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg"
            >
              Track delivery status →
            </button>
          </div>
        )}

        {/* ── STEP 4: Track ────────────────────────────────────────────── */}
        {step === 'track' && order && (
          <div className="space-y-4">
            <Section title={`Tracking order #${order.order_id}`}>
              {track ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={track.status} />
                    <span className="text-sm text-gray-400">
                      {track.status_description}
                    </span>
                  </div>

                  {track.courier && (
                    <div className="flex items-center gap-3 p-3 bg-[#181818] border border-white/10 rounded-lg">
                      {track.courier.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.courier.photo_url}
                          alt="courier"
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      )}
                      <div className="text-sm">
                        <p className="font-medium">{track.courier.name}</p>
                        <p className="text-gray-400">{track.courier.phone}</p>
                        {track.courier.latitude && (
                          <p className="text-xs text-gray-400">
                            📍 {Number(track.courier.latitude).toFixed(4)},{' '}
                            {Number(track.courier.longitude).toFixed(4)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {order.tracking_url && (
                    <a
                      href={order.tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-orange-600 hover:underline"
                    >
                      Open Borzo live tracking →
                    </a>
                  )}

                  {pollRef.current && (
                    <p className="text-xs text-gray-400">
                      Auto-refreshing every 10 s…
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Loading status…</p>
              )}
            </Section>

            {/* Cancel button — only show for non-terminal statuses */}
            {track &&
              !['completed', 'canceled'].includes(track.status) && (
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="w-full py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg text-sm disabled:opacity-50"
                >
                  {loading ? 'Cancelling…' : 'Cancel order'}
                </button>
              )}

            <button
              onClick={() => {
                stopPolling()
                setStep('form')
                setQuote(null)
                setOrder(null)
                setTrack(null)
                setDropoff(EMPTY_POINT)
              }}
              className="w-full py-2 text-sm text-gray-400 hover:text-white"
            >
              ← New delivery
            </button>
          </div>
        )}
      </div>


    </main>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#181818] border border-white/10 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function PointFields({
  label,
  value,
  onChange,
}: {
  label: string
  value: Point
  onChange: (p: Point) => void
}) {
  const set = (key: keyof Point) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value })

  return (
    <div className="space-y-3">
      <Field label={`${label} address`}>
        <input
          className="delivery-input"
          value={value.address}
          onChange={set('address')}
          placeholder="Full street address"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <input
            className="input"
            value={value.latitude}
            onChange={set('latitude')}
            placeholder="e.g. 17.4977"
            required
          />
        </Field>
        <Field label="Longitude">
          <input
            className="input"
            value={value.longitude}
            onChange={set('longitude')}
            placeholder="e.g. 78.3950"
            required
          />
        </Field>
        <Field label="Contact name">
          <input
            className="input"
            value={value.name}
            onChange={set('name')}
            placeholder="Full name"
            required
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={value.phone}
            onChange={set('phone')}
            placeholder="10-digit"
            required
          />
        </Field>
      </div>
      <Field label="Note for courier (optional)">
        <input
          className="delivery-input"
          value={value.note}
          onChange={set('note')}
          placeholder="e.g. Ring doorbell"
        />
      </Field>
    </div>
  )
}

function PriceLine({
  label,
  value,
  bold = false,
}: {
  label: string
  value: React.ReactNode
  bold?: boolean
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? 'font-bold text-white' : 'text-gray-300'}>
        {value}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOURS[status] || 'bg-white/10 text-gray-300'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}
