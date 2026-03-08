import { NextResponse } from 'next/server'
import {
  computeDiscount,
  isFirstOrderCustomer,
  validateCoupon,
} from '../../../../lib/discounts'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { CouponRecord } from '../../../../lib/types'

export async function POST(req: Request) {
  const {
    code,
    subtotal,
    customerClerkId,
  }: {
    code?: string
    subtotal?: number
    customerClerkId?: string
  } = await req.json()

  if (!code) {
    return NextResponse.json({ valid: false, reason: 'missing_code' }, { status: 400 })
  }

  const normalizedCode = code.trim().toUpperCase()
  const numericSubtotal = Number(subtotal || 0)
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )

  let couponRaw: CouponRecord | null = null
  if (hasSupabase) {
    const { data } = await supabaseAdmin
      .from('coupons')
      .select('*')
      .eq('code', normalizedCode)
      .maybeSingle()
    couponRaw = data as CouponRecord | null
  } else if (normalizedCode === 'WELCOME10') {
    couponRaw = {
      id: 'mock_coupon_1',
      code: 'WELCOME10',
      type: 'percent',
      value: 10,
      min_order: 0,
      usage_limit: 0,
      used_count: 0,
      expires_at: null,
      is_active: true,
    }
  }

  const coupon = couponRaw as CouponRecord | null
  if (!coupon) {
    return NextResponse.json({ valid: false, reason: 'not_found' }, { status: 404 })
  }

  const firstOrder = hasSupabase ? await isFirstOrderCustomer(customerClerkId, undefined) : true
  const validation = validateCoupon(coupon, {
    subtotal: numericSubtotal,
    isFirstOrder: firstOrder,
  })

  if (!validation.valid) {
    return NextResponse.json(
      { valid: false, reason: validation.reason || 'invalid' },
      { status: 400 }
    )
  }

  const discount = computeDiscount(numericSubtotal, coupon)
  return NextResponse.json({
    valid: true,
    coupon,
    discount,
    isFirstOrder: firstOrder,
  })
}
