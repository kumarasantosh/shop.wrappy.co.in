/**
 * GET /api/borzo/courier?order_id=123
 *
 * Returns courier info (name, phone, photo) and live GPS location.
 * Live location is only populated while order status is 'active'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { BorzoError, getCourier } from '../../../../lib/borzo'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const orderIdParam = searchParams.get('order_id')

    if (!orderIdParam) {
      return NextResponse.json(
        { error: 'order_id query param is required' },
        { status: 400 }
      )
    }

    const result = await getCourier(Number(orderIdParam))
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
