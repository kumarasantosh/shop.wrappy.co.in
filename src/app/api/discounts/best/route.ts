import { NextResponse } from 'next/server'
import {
  bestCouponForCart,
  computeDiscount,
  fetchActiveCoupons,
  isFirstOrderCustomer,
  validateCoupon,
} from '../../../../lib/discounts'
import { CouponRecord } from '../../../../lib/types'

export async function POST(req: Request) {
  try {
    const {
      subtotal,
      customerClerkId,
    }: { subtotal?: number; customerClerkId?: string } =
      await req.json()

    const numericSubtotal = Number(subtotal || 0)
    const hasSupabase = Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    )
    const coupons: CouponRecord[] = hasSupabase
      ? await fetchActiveCoupons()
      : [
          {
            id: 'mock_coupon',
            code: 'WELCOME10',
            type: 'percent',
            value: 10,
            min_order: 0,
            usage_limit: 0,
            used_count: 0,
            expires_at: null,
            is_active: true,
          },
        ]
    const firstOrder = hasSupabase ? await isFirstOrderCustomer(customerClerkId, undefined) : true
    const best = bestCouponForCart(numericSubtotal, coupons || [], firstOrder)
    const suggestionsRaw = (coupons || []).map((coupon) => {
        const validation = validateCoupon(coupon, {
          subtotal: numericSubtotal,
          isFirstOrder: firstOrder,
        })
        if (!validation.valid) return null
        const discount = computeDiscount(numericSubtotal, coupon)
        if (discount.discount <= 0) return null
        return {
          coupon,
          discount: discount.discount,
          total: discount.total,
        }
      })
    const suggestions = suggestionsRaw
      .filter(
        (
          row
        ): row is {
          coupon: CouponRecord
          discount: number
          total: number
        } => Boolean(row)
      )
      .sort((a, b) => {
        const byDiscount = b.discount - a.discount
        if (byDiscount !== 0) return byDiscount
        return a.total - b.total
      })
      .slice(0, 3)

    return NextResponse.json({
      best,
      suggestions,
      isFirstOrder: firstOrder,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'error' }, { status: 500 })
  }
}
