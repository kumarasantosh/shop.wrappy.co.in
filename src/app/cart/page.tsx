'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { useCartStore } from '../../store/cart'

type DiscountState = {
  code: string
  discount: number
}

const TAX_RATE = 0.05

export default function CartPage() {
  const { user } = useUser()
  const items = useCartStore((state) => state.items)
  const updateQty = useCartStore((state) => state.updateQty)
  const removeItem = useCartStore((state) => state.removeItem)
  const clear = useCartStore((state) => state.clear)
  const storedCouponCode = useCartStore((state) => state.couponCode)
  const setCouponCode = useCartStore((state) => state.setCouponCode)

  const [couponInput, setCouponInput] = useState(storedCouponCode || '')
  const [appliedDiscount, setAppliedDiscount] = useState<DiscountState | null>(null)
  const [bestCoupons, setBestCoupons] = useState<DiscountState[]>([])
  const [couponMsg, setCouponMsg] = useState('')
  const [loadingBestDiscount, setLoadingBestDiscount] = useState(false)

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  )
  const discountAmount = appliedDiscount?.discount || 0
  const taxableAmount = Math.max(0, subtotal - discountAmount)
  const tax = Math.round(taxableAmount * TAX_RATE)
  const total = taxableAmount + tax

  useEffect(() => {
    if (!subtotal) {
      setBestCoupons([])
      return
    }

    let cancelled = false
    async function fetchBestDiscount() {
      setLoadingBestDiscount(true)
      try {
        const response = await fetch('/api/discounts/best', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subtotal,
            customerClerkId: user?.id,
          }),
        })
        const payload = await response.json()
        if (cancelled) return
        const fromSuggestions = Array.isArray(payload?.suggestions)
          ? payload.suggestions
              .map((row: any) => ({
                code: String(row?.coupon?.code || '').toUpperCase(),
                discount: Number(row?.discount || 0),
              }))
              .filter((row: DiscountState) => Boolean(row.code) && row.discount > 0)
          : []

        if (fromSuggestions.length > 0) {
          setBestCoupons(fromSuggestions.slice(0, 3))
          return
        }

        if (payload.best?.coupon?.code) {
          setBestCoupons([
            {
              code: String(payload.best.coupon.code).toUpperCase(),
              discount: Number(payload.best.discount || 0),
            },
          ])
          return
        }

        setBestCoupons([])
      } catch {
        if (!cancelled) setBestCoupons([])
      } finally {
        if (!cancelled) setLoadingBestDiscount(false)
      }
    }

    fetchBestDiscount()
    return () => {
      cancelled = true
    }
  }, [subtotal, user?.id])

  useEffect(() => {
    setCouponCode(appliedDiscount?.code || '')
  }, [appliedDiscount?.code, setCouponCode])

  async function applyCoupon(explicitCode?: string) {
    const code = String(explicitCode || couponInput || '')
      .trim()
      .toUpperCase()
    if (!code) return

    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          subtotal,
          customerClerkId: user?.id,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.valid || !payload.coupon) {
        setAppliedDiscount(null)
        setCouponMsg(payload.reason || 'Invalid coupon')
        return
      }

      setAppliedDiscount({
        code: payload.coupon.code,
        discount: Number(payload.discount?.discount || 0),
      })
      setCouponInput(String(payload.coupon.code || '').toUpperCase())
      setCouponMsg(
        `${payload.coupon.code} applied. You saved ₹${payload.discount?.discount || 0}`
      )
    } catch {
      setCouponMsg('Error validating coupon')
    }
  }

  function applySuggestedCoupon(code: string) {
    setCouponInput(code)
    applyCoupon(code).catch(() => { })
  }

  function clearCoupon() {
    setAppliedDiscount(null)
    setCouponInput('')
    setCouponMsg('')
  }

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-5xl">🛒</p>
        <h2 className="mb-2 text-xl font-semibold">Your cart is empty</h2>
        <p className="mb-6 text-gray-500">Add some delicious items from our menu</p>
        <Link
          href="/menu"
          className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition-colors hover:bg-gray-200"
        >
          Browse Menu
        </Link>
      </div>
    )
  }

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Cart</h1>
        <button
          onClick={clear}
          className="text-sm text-red-400 transition-colors hover:text-red-300"
        >
          Clear all
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <AnimatePresence>
            {items.map((item) => (
              <motion.div
                key={item.lineId}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-[#181818] p-4"
              >
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-[#222]">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">
                      🍽️
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3 w-3 rounded-full ${item.isVeg ? 'bg-green-500' : 'bg-red-500'
                        }`}
                    />
                    <h3 className="truncate font-medium">{item.name}</h3>
                  </div>
                  {item.addons?.length ? (
                    <p className="mt-1 text-xs text-gray-400">
                      Add-ons: {item.addons.map((addon) => addon.name).join(', ')}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className="mt-1 text-xs text-gray-500">Note: {item.note}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-gray-500">₹{item.price} each</p>
                </div>

                <div className="flex items-center gap-2 rounded-xl bg-[#222] px-1 py-1">
                  <button
                    onClick={() => updateQty(item.lineId, item.qty - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#181818] font-bold text-white transition-colors hover:bg-[#333]"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{item.qty}</span>
                  <button
                    onClick={() => updateQty(item.lineId, item.qty + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#181818] font-bold text-white transition-colors hover:bg-[#333]"
                  >
                    +
                  </button>
                </div>

                <div className="text-right">
                  <p className="font-semibold">₹{item.price * item.qty}</p>
                  <button
                    onClick={() => removeItem(item.lineId)}
                    className="mt-1 text-xs text-gray-600 transition-colors hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="sticky top-20 h-fit space-y-5 rounded-2xl border border-white/10 bg-[#181818] p-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-400">Discounts & Coupons</p>
            <div className="flex gap-2">
              <input
                value={couponInput}
                onChange={(event) =>
                  setCouponInput(event.target.value.toUpperCase())
                }
                placeholder="ENTER COUPON"
                className="flex-1 rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
              <button
                onClick={() => {
                  applyCoupon().catch(() => { })
                }}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
              >
                Apply
              </button>
            </div>
            {appliedDiscount && (
              <button
                onClick={clearCoupon}
                className="text-xs text-gray-500 underline underline-offset-4 hover:text-white"
              >
                Remove applied coupon
              </button>
            )}
            {couponMsg && (
              <p
                className={`text-xs ${appliedDiscount ? 'text-green-400' : 'text-red-400'
                  }`}
              >
                {couponMsg}
              </p>
            )}
            {loadingBestDiscount ? (
              <p className="text-xs text-emerald-300">Finding best coupons...</p>
            ) : bestCoupons.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-emerald-300">Best coupons for you</p>
                <div className="flex flex-wrap gap-2">
                  {bestCoupons.map((coupon) => (
                    <button
                      key={coupon.code}
                      type="button"
                      onClick={() => applySuggestedCoupon(coupon.code)}
                      className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/20"
                    >
                      {coupon.code} (₹{coupon.discount} off)
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!appliedDiscount && bestCoupons.length > 0 && (
              <p className="text-xs text-gray-500">
                Coupon is optional. Tap any best coupon above to apply.
              </p>
            )}
          </div>

          <div className="space-y-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Bill Details
            </p>
            <div className="flex justify-between">
              <span className="text-gray-400">Subtotal</span>
              <span>₹{subtotal}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-green-400">
                <span>
                  Discount {appliedDiscount ? `(${appliedDiscount.code})` : ''}
                </span>
                <span>−₹{discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-400">GST (5%)</span>
              <span>₹{tax}</span>
            </div>

            <div className="flex justify-between border-t border-white/10 pt-3 text-base font-bold">
              <span>Grand Total</span>
              <span>₹{total}</span>
            </div>
          </div>

          <Link
            href="/checkout"
            className="block w-full rounded-xl bg-white py-3 text-center text-sm font-semibold text-black transition-colors hover:bg-gray-200"
          >
            Razorpay Checkout
          </Link>
        </div>
      </div>
    </div>
  )
}
