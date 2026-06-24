import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import {
  calcSubtotal,
  computeDiscount,
  isFirstOrderCustomer,
  validateCoupon,
} from '../../../../lib/discounts'
import { createOrderPayload, signCheckoutDraftToken } from '../../../../lib/razorpay'
import { getDefaultStoreSettings, isStoreOpenNow, normalizeStoreSettings } from '../../../../lib/storeStatus'
import {
  appendOrderMeta,
  generatePickupVerificationCode,
} from '../../../../lib/orderMeta'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { CouponRecord, ProductAddon, StoreSettingsRecord } from '../../../../lib/types'

const TAX_RATE = 0.05
const PACKING_FEE_PER_ITEM = 5

const KEY_ID = process.env.RAZORPAY_KEY_ID || ''
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || ''
const CHECKOUT_DRAFT_SECRET = process.env.CHECKOUT_DRAFT_SECRET || KEY_SECRET

type ItemPayload = {
  id: string
  qty: number
  price: number
  addons?: ProductAddon[]
}

type CheckoutDraftPayload = {
  version: 1
  created_at: string
  expires_at: string
  customer_clerk_id: string | null
  items: ItemPayload[]
  subtotal: number
  discount: number
  tax: number
  packing_fee: number
  delivery_fee: number
  total: number
  eta: string
  estimated_delivery_minutes: number
  address: string
  phone: string | null
  instructions: string | null
  coupon_code: string | null
  coupon_id: string | null
  payment_method: 'razorpay'
  order_type: 'delivery' | 'pickup'
  pickup_slot: string | null
  pickup_code: string | null
  delivery_lat: number | null
  delivery_lng: number | null
  razorpay_order_id: string
}

function minutesUntilOpen(settings: StoreSettingsRecord, nowDate: Date = new Date()): number {
  const [h, m] = settings.open_time.slice(0, 5).split(':').map(Number)
  const openDate = new Date(nowDate)
  openDate.setHours(h, m, 0, 0)

  if (openDate.getTime() <= nowDate.getTime()) {
    openDate.setDate(openDate.getDate() + 1)
  }

  return Math.ceil((openDate.getTime() - nowDate.getTime()) / 60000)
}

function computeEta(settings: StoreSettingsRecord, nowDate: Date = new Date()): {
  eta: string
  etaMinutes: number
} {
  const isOpen = isStoreOpenNow(settings, nowDate)
  const base = Number(settings.estimated_delivery_minutes || 30)
  const preorderDelay = isOpen ? 0 : minutesUntilOpen(settings, nowDate)
  const etaMinutes = Math.max(1, base + preorderDelay)
  return { eta: new Date(nowDate.getTime() + etaMinutes * 60_000).toISOString(), etaMinutes }
}

const DATETIME_LOCAL_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const DEFAULT_STORE_TIMEZONE_OFFSET_MINUTES = Number(
  process.env.STORE_TIMEZONE_OFFSET_MINUTES || -330
)

function parsePickupSlotToDate(
  pickupSlot: string | undefined,
  pickupSlotTimezoneOffsetMinutes: number | undefined
) {
  const raw = String(pickupSlot || '').trim()
  if (!raw) return null

  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  if (hasExplicitTimezone) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const localMatch = raw.match(DATETIME_LOCAL_REGEX)
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch
    const providedOffset = Number(pickupSlotTimezoneOffsetMinutes)
    const offset =
      Number.isFinite(providedOffset) && Math.abs(providedOffset) <= 14 * 60
        ? providedOffset
        : DEFAULT_STORE_TIMEZONE_OFFSET_MINUTES

    const utcTimeMs =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second || 0)
      ) +
      offset * 60_000

    const parsed = new Date(utcTimeMs)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const hasSupabase = Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    )

    const body = (await req.json()) as {
      items?: ItemPayload[]
      phone?: string
      address?: string
      instructions?: string
      couponCode?: string
      paymentMethod?: 'razorpay'
      orderType?: string
      pickupSlot?: string
      pickupSlotTimezoneOffsetMinutes?: number
      includePacking?: boolean
      latitude?: number
      longitude?: number
    }

    const isPickup = !body.orderType || body.orderType === 'pickup'
    const orderType: 'delivery' | 'pickup' = isPickup ? 'pickup' : 'delivery'

    const items = body.items || []
    if (items.length === 0) {
      return NextResponse.json({ error: 'empty_cart' }, { status: 400 })
    }

    if (hasSupabase) {
      const uniqueProductIds = Array.from(
        new Set(items.map((item) => String(item.id || '')).filter(Boolean))
      )

      if (uniqueProductIds.length === 0) {
        return NextResponse.json({ error: 'invalid_cart_items' }, { status: 400 })
      }

      const { data: productRows, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id,name,is_available')
        .in('id', uniqueProductIds)

      if (productsError) {
        return NextResponse.json({ error: productsError.message }, { status: 500 })
      }

      const productMap = new Map(
        (productRows || []).map((row: any) => [String(row.id), row])
      )

      const unavailable = uniqueProductIds
        .map((productId) => productMap.get(productId))
        .filter((row) => !row || row.is_available === false)
        .map((row) => String(row?.name || 'Item'))

      if (unavailable.length > 0) {
        return NextResponse.json(
          {
            error: 'product_unavailable',
            reason: 'currently_not_available',
            items: unavailable,
          },
          { status: 400 }
        )
      }
    }

    const phone = String(body.phone || '').trim()
    if (!phone) {
      return NextResponse.json({ error: 'phone_required' }, { status: 400 })
    }

    // Delivery-specific validation
    let deliveryAddress = 'Self Pickup at Store'
    let deliveryLat: number | null = null
    let deliveryLng: number | null = null

    if (!isPickup) {
      const rawAddress = String(body.address || '').trim()
      if (!rawAddress) {
        return NextResponse.json({ error: 'address_required' }, { status: 400 })
      }
      const rawLat = Number(body.latitude)
      const rawLng = Number(body.longitude)
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
        return NextResponse.json({ error: 'coordinates_required' }, { status: 400 })
      }
      deliveryAddress = rawAddress
      deliveryLat = rawLat
      deliveryLng = rawLng
    }

    // Pickup-specific validation
    let pickupSlotIso: string | null = null
    let pickupCode: string | null = null

    if (isPickup) {
      const slotDate = parsePickupSlotToDate(
        body.pickupSlot,
        body.pickupSlotTimezoneOffsetMinutes
      )
      if (!slotDate) {
        return NextResponse.json({ error: 'pickup_slot_required' }, { status: 400 })
      }
      if (slotDate.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: 'pickup_slot_in_past' }, { status: 400 })
      }
      pickupSlotIso = slotDate.toISOString()
      pickupCode = generatePickupVerificationCode()
    }

    if (body.paymentMethod && body.paymentMethod !== 'razorpay') {
      return NextResponse.json({ error: 'payment_method_not_supported' }, { status: 400 })
    }
    const paymentMethod = 'razorpay' as const

    if (!KEY_ID || !KEY_SECRET) {
      return NextResponse.json({ error: 'razorpay_not_configured' }, { status: 503 })
    }

    let settings = getDefaultStoreSettings()
    if (hasSupabase) {
      const { data: settingsRow } = await supabaseAdmin
        .from('store_settings')
        .select('*')
        .limit(1)
        .maybeSingle()
      settings = normalizeStoreSettings(settingsRow as Partial<StoreSettingsRecord>)
    }

    const currentlyOpen = isStoreOpenNow(settings)
    if (settings.force_closed) {
      return NextResponse.json({ error: 'store_closed', reason: 'manually_closed' }, { status: 400 })
    }
    if (!currentlyOpen && !settings.allow_preorder) {
      return NextResponse.json({ error: 'store_closed' }, { status: 400 })
    }

    const subtotal = calcSubtotal(
      items.map((item) => ({ id: item.id, price: item.price, qty: item.qty }))
    )
    const totalItemCount = items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    // Delivery always includes packing; pickup respects user preference
    const includePackingForPickup = body.includePacking !== false
    const packingFee =
      !isPickup || includePackingForPickup ? totalItemCount * PACKING_FEE_PER_ITEM : 0
    const firstOrder = hasSupabase
      ? await isFirstOrderCustomer(userId, undefined)
      : true

    let appliedCoupon: CouponRecord | null = null
    let discountAmount = 0

    if (body.couponCode && hasSupabase) {
      const code = body.couponCode.trim().toUpperCase()
      const { data: codeCouponRaw } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .eq('code', code)
        .maybeSingle()

      const codeCoupon = codeCouponRaw as CouponRecord | null
      const validation = validateCoupon(codeCoupon, {
        subtotal,
        isFirstOrder: firstOrder,
      })
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: 'invalid_coupon',
            reason: validation.reason,
          },
          { status: 400 }
        )
      }

      if (codeCoupon) {
        const discount = computeDiscount(subtotal, codeCoupon)
        appliedCoupon = codeCoupon
        discountAmount = discount.discount
      }
    }

    const discountedSubtotal = Math.max(0, subtotal - discountAmount)
    const tax = Math.round(discountedSubtotal * TAX_RATE)

    // For delivery: fetch a server-side fee quote (same logic as /api/delivery/quote)
    let deliveryFee = 0
    if (!isPickup && deliveryLat !== null && deliveryLng !== null) {
      const STORE_LAT = Number(process.env.STORE_LATITUDE || '0')
      const STORE_LNG = Number(process.env.STORE_LONGITUDE || '0')
      const BASE_FEE = Number(process.env.DELIVERY_BASE_FEE || '40')
      const FEE_PER_KM = Number(process.env.DELIVERY_FEE_PER_KM || '10')
      const FREE_ABOVE = Number(process.env.FREE_DELIVERY_ABOVE || '0')

      if (FREE_ABOVE > 0 && discountedSubtotal >= FREE_ABOVE) {
        deliveryFee = 0
      } else if (STORE_LAT && STORE_LNG) {
        const dLat = ((deliveryLat - STORE_LAT) * Math.PI) / 180
        const dLng = ((deliveryLng - STORE_LNG) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((STORE_LAT * Math.PI) / 180) *
          Math.cos((deliveryLat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2
        const distKm = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
        deliveryFee = Math.round(Math.max(BASE_FEE, BASE_FEE + Math.max(0, distKm - 1) * FEE_PER_KM))
      } else {
        deliveryFee = Number(process.env.DELIVERY_BASE_FEE || '40')
      }
    }

    const total = discountedSubtotal + tax + packingFee + deliveryFee

    const etaInfo = isPickup && pickupSlotIso
      ? {
          eta: pickupSlotIso,
          etaMinutes: Math.max(1, Math.ceil((new Date(pickupSlotIso).getTime() - Date.now()) / 60000)),
        }
      : computeEta(settings)

    const fullInstructions = appendOrderMeta(body.instructions, {
      orderType,
      pickupSlot: pickupSlotIso,
      pickupCode,
      deliveryLat,
      deliveryLng,
    })

    const rzp = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
    const rzpOrder = await rzp.orders.create(
      createOrderPayload(Number(total), `draft_${Date.now()}`)
    )
    const nowIso = new Date().toISOString()
    const expiresIso = new Date(Date.now() + 30 * 60_000).toISOString()

    const draftPayload: CheckoutDraftPayload = {
      version: 1,
      created_at: nowIso,
      expires_at: expiresIso,
      customer_clerk_id: userId || null,
      items: items.map((item) => ({
        id: item.id,
        qty: Number(item.qty),
        price: Number(item.price),
        addons: item.addons || [],
      })),
      subtotal,
      discount: discountAmount,
      tax,
      packing_fee: packingFee,
      delivery_fee: deliveryFee,
      total,
      eta: etaInfo.eta,
      estimated_delivery_minutes: etaInfo.etaMinutes,
      address: isPickup ? 'Self Pickup at Store' : deliveryAddress,
      phone: phone || null,
      instructions: fullInstructions || null,
      coupon_code: appliedCoupon?.code || null,
      coupon_id: appliedCoupon?.id || null,
      payment_method: paymentMethod,
      order_type: orderType,
      pickup_slot: pickupSlotIso,
      pickup_code: pickupCode,
      delivery_lat: deliveryLat,
      delivery_lng: deliveryLng,
      razorpay_order_id: rzpOrder.id,
    }
    const draftToken = signCheckoutDraftToken(draftPayload, CHECKOUT_DRAFT_SECRET)

    // Auto-save phone number for logged-in users (fire-and-forget)
    if (userId && phone && hasSupabase) {
      Promise.resolve(
        supabaseAdmin
          .from('customer_phones')
          .upsert(
            { customer_clerk_id: userId, phone },
            { onConflict: 'customer_clerk_id,phone' }
          )
      ).catch(() => { })
    }

    return NextResponse.json({
      rzpOrder,
      key_id: KEY_ID,
      draftToken,
      orderType,
      pickupSlot: pickupSlotIso,
      deliveryFee,
      total,
    })
  } catch (err: any) {
    return NextResponse.json({ error: (err && err.message) || 'error' }, { status: 500 })
  }
}
