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
import { calculateOrder, BorzoError } from '../../../../lib/borzo'
import { getBranchById, getBranchProductMap } from '../../../../lib/branchesServer'
import { BranchRecord } from '../../../../lib/branches'

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
  order_type: 'pickup' | 'delivery'
  pickup_slot: string | null
  pickup_code: string | null
  razorpay_order_id: string
  // Branch fulfilment
  branch_id: string | null
  pickup_address: string
  pickup_name: string
  pickup_phone: string
  pickup_latitude: number | null
  pickup_longitude: number | null
  // Delivery-only fields
  dropoff_latitude: number | null
  dropoff_longitude: number | null
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

type PickupOrigin = {
  address: string
  name: string
  phone: string
  latitude: number
  longitude: number
}

function resolvePickupOrigin(branch: BranchRecord | null): PickupOrigin {
  const branchLat = branch?.latitude != null ? Number(branch.latitude) : 0
  const branchLng = branch?.longitude != null ? Number(branch.longitude) : 0
  return {
    address:
      branch?.address ||
      process.env.PORTER_PICKUP_ADDRESS ||
      'Wrappy, Kukatpally, Hyderabad',
    name: branch?.name || process.env.PORTER_PICKUP_NAME || 'Wrappy',
    phone: branch?.phone || process.env.PORTER_PICKUP_PHONE || '9182285342',
    latitude:
      branchLat || Number(process.env.STORE_LATITUDE || process.env.PORTER_PICKUP_LATITUDE || 0),
    longitude:
      branchLng || Number(process.env.STORE_LONGITUDE || process.env.PORTER_PICKUP_LONGITUDE || 0),
  }
}

async function quoteBorzoDeliveryFee(
  customerAddress: string,
  customerLat: number,
  customerLng: number,
  phone: string,
  pickup: PickupOrigin
): Promise<number> {
  const storeLat = pickup.latitude
  const storeLng = pickup.longitude

  if (!storeLat || !storeLng) return 0

  try {
    const result = await calculateOrder({
      type: 'standard',
      matter: 'Food',
      total_weight_kg: 1,
      points: [
        {
          address: pickup.address,
          latitude: storeLat,
          longitude: storeLng,
          contact_person: {
            name: pickup.name,
            phone: pickup.phone,
          },
        },
        {
          address: customerAddress || 'Customer Address',
          latitude: customerLat,
          longitude: customerLng,
          contact_person: { name: 'Customer', phone: phone || '9000000000' },
        },
      ],
    })

    const order = result.order as Record<string, unknown>
    return order?.payment_amount ? Math.round(Number(order.payment_amount)) : 0
  } catch (err: unknown) {
    const msg = err instanceof BorzoError ? err.message : String(err)
    console.warn('[orders/create] Borzo quote failed, using fee=0:', msg)
    return 0
  }
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
      branchId?: string
    }

    const isPickup = !body.orderType || body.orderType === 'pickup'

    // Resolve the fulfilling branch (nearest/selected). Non-fatal: an unknown,
    // stale, or inactive branch id must never block checkout — fall back to the
    // single-store env config instead.
    let branch: BranchRecord | null = body.branchId
      ? await getBranchById(String(body.branchId))
      : null
    if (body.branchId && !branch) {
      console.warn('[orders/create] branch not found, falling back to default store:', body.branchId)
    }
    if (branch && branch.is_active === false) {
      console.warn('[orders/create] branch inactive, falling back to default store:', branch.id)
      branch = null
    }
    const pickupOrigin = resolvePickupOrigin(branch)

    const items = body.items || []
    if (items.length === 0) {
      return NextResponse.json({ error: 'empty_cart', reason: 'empty_cart' }, { status: 400 })
    }

    if (hasSupabase) {
      const uniqueProductIds = Array.from(
        new Set(items.map((item) => String(item.id || '')).filter(Boolean))
      )

      if (uniqueProductIds.length === 0) {
        return NextResponse.json({ error: 'invalid_cart_items', reason: 'invalid_cart_items' }, { status: 400 })
      }

      const { data: productRows, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id,name,is_available,price,addons')
        .in('id', uniqueProductIds)

      if (productsError) {
        console.error('[orders/create] products query failed:', productsError)
        return NextResponse.json(
          { error: 'products_query_failed', reason: productsError.message },
          { status: 500 }
        )
      }

      const productMap = new Map(
        (productRows || []).map((row: any) => [String(row.id), row])
      )

      // Per-branch availability + price overrides.
      const branchOverrides = branch ? await getBranchProductMap(branch.id) : new Map()

      const unavailable = uniqueProductIds
        .map((productId) => ({ id: productId, row: productMap.get(productId), ov: branchOverrides.get(productId) }))
        .filter(({ row, ov }) => !row || row.is_available === false || (ov && ov.is_available === false))
        .map(({ row }) => String(row?.name || 'Item'))

      // Calculate item price entirely on the server to prevent client-side tampering.
      for (const item of items) {
        const row = productMap.get(String(item.id))
        if (!row) continue

        // Start with base price (from branch override or product catalogue)
        let unitPrice = Number(row.price)
        const ov = branchOverrides.get(String(item.id))
        if (ov && ov.price_override != null) {
          unitPrice = Number(ov.price_override)
        }

        // Add valid addon prices from the server catalogue
        if (Array.isArray(item.addons) && Array.isArray(row.addons)) {
          for (const itemAddon of item.addons) {
            const serverAddon = row.addons.find((a: any) => a.id === itemAddon.id || a.name === itemAddon.name)
            if (serverAddon) {
              unitPrice += Number(serverAddon.price || 0)
              // Update the addon price to the server one just in case the client sent a fake one
              itemAddon.price = Number(serverAddon.price || 0)
            }
          }
        }
        
        // Overwrite the client-provided price with the server-calculated true price
        item.price = Math.max(0, unitPrice)
      }

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
      return NextResponse.json({ error: 'phone_required', reason: 'phone_required' }, { status: 400 })
    }

    // ── Pickup slot validation (pickup only) ─────────────────────────────
    let pickupSlotIso: string | null = null
    let pickupCode: string | null = null

    if (isPickup) {
      const slotDate = parsePickupSlotToDate(
        body.pickupSlot,
        body.pickupSlotTimezoneOffsetMinutes
      )
      if (!slotDate) {
        return NextResponse.json({ error: 'pickup_slot_required', reason: 'pickup_slot_required' }, { status: 400 })
      }
      if (slotDate.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: 'pickup_slot_in_past', reason: 'pickup_slot_in_past' }, { status: 400 })
      }
      pickupSlotIso = slotDate.toISOString()
      pickupCode = generatePickupVerificationCode()
    } else {
      // Delivery: require customer coordinates
      if (!body.latitude || !body.longitude) {
        return NextResponse.json(
          { error: 'delivery_coordinates_required', reason: 'delivery_coordinates_required' },
          { status: 400 }
        )
      }
    }

    if (body.paymentMethod && body.paymentMethod !== 'razorpay') {
      return NextResponse.json(
        { error: 'payment_method_not_supported', reason: 'payment_method_not_supported' },
        { status: 400 }
      )
    }
    const paymentMethod = 'razorpay' as const

    if (!KEY_ID || !KEY_SECRET) {
      console.error('[orders/create] Razorpay keys missing in this environment')
      return NextResponse.json(
        { error: 'razorpay_not_configured', reason: 'razorpay_not_configured' },
        { status: 503 }
      )
    }

    let settings = getDefaultStoreSettings()
    if (branch) {
      // Branch opening hours take precedence over the global store settings.
      settings = normalizeStoreSettings(branch as unknown as Partial<StoreSettingsRecord>)
    } else if (hasSupabase) {
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
      return NextResponse.json({ error: 'store_closed', reason: 'currently_closed' }, { status: 400 })
    }

    const subtotal = calcSubtotal(
      items.map((item) => ({ id: item.id, price: item.price, qty: item.qty }))
    )
    const totalItemCount = items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    const includePacking = body.includePacking !== false
    const packingFee = includePacking ? totalItemCount * PACKING_FEE_PER_ITEM : 0
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

    // ── Delivery fee (quoted from Borzo for delivery orders) ─────────────
    let deliveryFee = 0
    if (!isPickup) {
      deliveryFee = await quoteBorzoDeliveryFee(
        body.address || '',
        Number(body.latitude),
        Number(body.longitude),
        phone,
        pickupOrigin
      )
    }

    const total = discountedSubtotal + tax + packingFee + deliveryFee

    // ── ETA ───────────────────────────────────────────────────────────────
    let etaInfo: { eta: string; etaMinutes: number }
    if (isPickup) {
      etaInfo = {
        eta: pickupSlotIso!,
        etaMinutes: Math.max(1, Math.ceil((new Date(pickupSlotIso!).getTime() - Date.now()) / 60000)),
      }
    } else {
      // Use store's estimated_delivery_minutes for Borzo delivery
      const deliveryMinutes = Math.max(30, Number(settings.estimated_delivery_minutes || 45))
      etaInfo = {
        eta: new Date(Date.now() + deliveryMinutes * 60_000).toISOString(),
        etaMinutes: deliveryMinutes,
      }
    }

    // ── Instructions ─────────────────────────────────────────────────────
    const fullInstructions = isPickup
      ? appendOrderMeta(body.instructions, {
          orderType: 'pickup',
          pickupSlot: pickupSlotIso!,
          pickupCode: pickupCode!,
        })
      : body.instructions || null

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
      address: isPickup ? 'Self Pickup at Store' : (body.address || ''),
      phone: phone || null,
      instructions: fullInstructions || null,
      coupon_code: appliedCoupon?.code || null,
      coupon_id: appliedCoupon?.id || null,
      payment_method: paymentMethod,
      order_type: isPickup ? 'pickup' : 'delivery',
      pickup_slot: pickupSlotIso,
      pickup_code: pickupCode,
      razorpay_order_id: rzpOrder.id,
      branch_id: branch?.id || null,
      pickup_address: pickupOrigin.address,
      pickup_name: pickupOrigin.name,
      pickup_phone: pickupOrigin.phone,
      pickup_latitude: pickupOrigin.latitude || null,
      pickup_longitude: pickupOrigin.longitude || null,
      dropoff_latitude: isPickup ? null : Number(body.latitude),
      dropoff_longitude: isPickup ? null : Number(body.longitude),
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
      orderType: isPickup ? 'pickup' : 'delivery',
      pickupSlot: pickupSlotIso,
      deliveryFee,
      total,
    })
  } catch (err: any) {
    // Log full detail server-side (visible in Vercel function logs) since the
    // client only ever surfaces a short reason string.
    console.error('[orders/create] unhandled error:', err)
    const message =
      (err && err.error && err.error.description) || // Razorpay SDK error shape
      (err && err.message) ||
      'error'
    return NextResponse.json({ error: 'unhandled_error', reason: message }, { status: 500 })
  }
}
