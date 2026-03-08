import { supabaseAdmin } from './supabaseAdmin'
import { CouponRecord } from './types'

export type PricedCartItem = { id: string; price: number; qty: number }

export type CouponValidationInput = {
  subtotal: number
  isFirstOrder: boolean
  now?: Date
}

export type CouponValidationResult = {
  valid: boolean
  reason?: string
}

export type DiscountComputation = {
  discount: number
  total: number
}

export async function fetchActiveCoupons() {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })

  if (error) return []
  return (data || []) as CouponRecord[]
}

export function calcSubtotal(items: PricedCartItem[]) {
  return items.reduce((sum, item) => sum + Number(item.price) * item.qty, 0)
}

export function validateCoupon(
  coupon: CouponRecord | null | undefined,
  input: CouponValidationInput
): CouponValidationResult {
  if (!coupon) return { valid: false, reason: 'not_found' }
  if (!coupon.is_active) return { valid: false, reason: 'inactive' }

  const now = input.now || new Date()
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) {
    return { valid: false, reason: 'expired' }
  }

  if (coupon.usage_limit > 0 && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, reason: 'usage_exhausted' }
  }

  if (coupon.min_order > 0 && input.subtotal < coupon.min_order) {
    return { valid: false, reason: 'min_order_not_met' }
  }

  if (coupon.type === 'first_order' && !input.isFirstOrder) {
    return { valid: false, reason: 'not_first_order' }
  }

  return { valid: true }
}

export function computeDiscount(subtotal: number, coupon: CouponRecord): DiscountComputation {
  if (subtotal <= 0) return { discount: 0, total: 0 }

  if (coupon.type === 'percent') {
    const discount = Math.round((subtotal * coupon.value) / 100)
    return { discount, total: Math.max(0, subtotal - discount) }
  }

  const discount = Math.min(subtotal, coupon.value)
  return { discount, total: Math.max(0, subtotal - discount) }
}

export function bestCouponForCart(
  subtotal: number,
  coupons: CouponRecord[],
  isFirstOrder: boolean
) {
  if (!coupons.length || subtotal <= 0) return null

  let best:
    | {
        coupon: CouponRecord
        discount: number
        total: number
      }
    | null = null

  for (const coupon of coupons) {
    const validation = validateCoupon(coupon, { subtotal, isFirstOrder })
    if (!validation.valid) continue
    const discount = computeDiscount(subtotal, coupon)

    if (!best || discount.discount > best.discount) {
      best = { coupon, ...discount }
    }
  }

  return best
}

export async function isFirstOrderCustomer(
  customerClerkId: string | null | undefined,
  phone: string | null | undefined
) {
  if (!customerClerkId && !phone) return true

  let query = supabaseAdmin.from('orders').select('id', { count: 'exact', head: true })
  if (customerClerkId && phone) {
    query = query.or(`customer_clerk_id.eq.${customerClerkId},phone.eq.${phone}`)
  } else if (customerClerkId) {
    query = query.eq('customer_clerk_id', customerClerkId)
  } else if (phone) {
    query = query.eq('phone', phone)
  }

  const { count } = await query
  return Number(count || 0) === 0
}
