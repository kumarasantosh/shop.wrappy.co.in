import { NextResponse } from 'next/server'
import {
  bestCouponForCart,
  fetchActiveCoupons,
  isFirstOrderCustomer,
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

    return NextResponse.json({
      best,
      isFirstOrder: firstOrder,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'error' }, { status: 500 })
  }
}
