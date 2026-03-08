import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import {
  bestCouponForCart,
  calcSubtotal,
  computeDiscount,
  fetchActiveCoupons,
  isFirstOrderCustomer,
  validateCoupon,
} from '../../../../lib/discounts'
import { createOrderPayload, signCheckoutDraftToken } from '../../../../lib/razorpay'
import { getDefaultStoreSettings, isStoreOpenNow, normalizeStoreSettings } from '../../../../lib/storeStatus'
import { isWithinDeliveryRadius, MAX_DELIVERY_DISTANCE_KM } from '../../../../lib/deliveryRadius'
import {
  appendOrderMeta,
  generatePickupVerificationCode,
  OrderType,
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
  order_type: OrderType
  pickup_slot: string | null
  pickup_code: string | null
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

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const hasSupabase = Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    )

    const body = (await req.json()) as {
      items?: ItemPayload[]
      address?: string
      phone?: string
      instructions?: string
      couponCode?: string
      paymentMethod?: 'razorpay'
      orderType?: OrderType
      pickupSlot?: string
      includePacking?: boolean
      latitude?: number
      longitude?: number
    }

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

    const orderType: OrderType = body.orderType === 'pickup' ? 'pickup' : 'delivery'
    const address = String(body.address || '').trim()
    const phone = String(body.phone || '').trim()
    if (!phone) {
      return NextResponse.json({ error: 'phone_required' }, { status: 400 })
    }
    if (orderType === 'delivery' && !address) {
      return NextResponse.json({ error: 'address_required' }, { status: 400 })
    }

    let pickupSlotIso: string | null = null
    let pickupCode: string | null = null

    if (orderType === 'pickup') {
      const slotDate = body.pickupSlot ? new Date(body.pickupSlot) : null
      if (!slotDate || Number.isNaN(slotDate.getTime())) {
        return NextResponse.json({ error: 'pickup_slot_required' }, { status: 400 })
      }

      if (slotDate.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: 'pickup_slot_in_past' }, { status: 400 })
      }

      pickupSlotIso = slotDate.toISOString()
      pickupCode = generatePickupVerificationCode()
    } else {
      const hasCoordinates =
        body.latitude !== undefined &&
        body.latitude !== null &&
        body.longitude !== undefined &&
        body.longitude !== null

      if (hasCoordinates) {
        const lat = Number(body.latitude)
        const lng = Number(body.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 })
        }

        const radiusCheck = await isWithinDeliveryRadius(lat, lng)
        if (!radiusCheck.withinRange) {
          return NextResponse.json(
            {
              error: 'outside_delivery_radius',
              reason: `more_than_${MAX_DELIVERY_DISTANCE_KM}km_away`,
              distance_km: Number(radiusCheck.distanceKm.toFixed(2)),
              distance_method: radiusCheck.method,
            },
            { status: 400 }
          )
        }
      }
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
    const includePackingForPickup = body.includePacking !== false
    const shouldApplyPackingFee = orderType === 'delivery' || includePackingForPickup
    const packingFee = shouldApplyPackingFee ? totalItemCount * PACKING_FEE_PER_ITEM : 0
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

    // Auto apply best discount if it is better than manually selected discount.
    const activeCoupons = hasSupabase ? await fetchActiveCoupons() : []
    const best = bestCouponForCart(subtotal, activeCoupons, firstOrder)
    if (best && best.discount > discountAmount) {
      appliedCoupon = best.coupon
      discountAmount = best.discount
    }

    const discountedSubtotal = Math.max(0, subtotal - discountAmount)
    const tax = Math.round(discountedSubtotal * TAX_RATE)
    const deliveryFee = 0
    const total = discountedSubtotal + tax + packingFee + deliveryFee
    const etaInfo = pickupSlotIso
      ? {
        eta: pickupSlotIso,
        etaMinutes: Math.max(1, Math.ceil((new Date(pickupSlotIso).getTime() - Date.now()) / 60000)),
      }
      : computeEta(settings)

    const fullInstructions = appendOrderMeta(body.instructions, {
      orderType,
      pickupSlot: pickupSlotIso,
      pickupCode,
    })
    const customerAddress = orderType === 'pickup' ? 'Self Pickup at Store' : address

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
      address: customerAddress,
      phone: phone || null,
      instructions: fullInstructions || null,
      coupon_code: appliedCoupon?.code || null,
      coupon_id: appliedCoupon?.id || null,
      payment_method: paymentMethod,
      order_type: orderType,
      pickup_slot: pickupSlotIso,
      pickup_code: pickupCode,
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
    })
  } catch (err: any) {
    return NextResponse.json({ error: (err && err.message) || 'error' }, { status: 500 })
  }
}
