/**
 * GET /api/borzo/orders
 * GET /api/borzo/orders?order_id=123
 *
 * Without query param: returns all Borzo orders for the account (sorted desc).
 * With ?order_id=123: returns that specific order (polls for status updates).
 *
 * Use this as a fallback tracking mechanism when Borzo callbacks are not
 * reachable. For live apps, prefer the callback at /api/borzo/callback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { BorzoError, getOrders } from '../../../../lib/borzo'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const orderIdParam = searchParams.get('order_id')

    const result = orderIdParam
      ? await getOrders(Number(orderIdParam))
      : await getOrders()

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err instanceof BorzoError) {
      return NextResponse.json(
        { error: err.message, codes: err.errors },
        { status: 422 }
      )
    }
    const message = err instanceof Error ? err.message : 'internal_error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
