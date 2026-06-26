/**
 * POST /api/borzo/quote
 *
 * Returns a live Borzo delivery fee estimate for the checkout page.
 * Uses STORE_LATITUDE / STORE_LONGITUDE from env as the pickup point.
 * All Borzo calls are server-side — the auth token is never exposed to the browser.
 *
 * Request body:
 *   { address: string, latitude: number, longitude: number, phone?: string }
 *
 * Response (always 200 — never block checkout on a quote failure):
 *   { fee: number, warnings?: string[], error?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { BorzoError, calculateOrder } from '../../../../lib/borzo'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { address, latitude, longitude } = body as {
      address?: string
      latitude?: number
      longitude?: number
    }

    if (!latitude || !longitude) {
      return NextResponse.json({ fee: 0, error: 'latitude_and_longitude_required' }, { status: 400 })
    }

    const storeLat = Number(
      process.env.STORE_LATITUDE || process.env.PORTER_PICKUP_LATITUDE || 0
    )
    const storeLng = Number(
      process.env.STORE_LONGITUDE || process.env.PORTER_PICKUP_LONGITUDE || 0
    )

    if (!storeLat || !storeLng) {
      return NextResponse.json({ fee: 0, error: 'store_location_not_configured' })
    }

    const storeAddress =
      process.env.PORTER_PICKUP_ADDRESS || 'Wrappy, Kukatpally, Hyderabad'
    const storeName = process.env.PORTER_PICKUP_NAME || 'Wrappy'
    const storePhone = process.env.PORTER_PICKUP_PHONE || '9182285342'

    const result = await calculateOrder({
      type: 'standard',
      matter: 'Food',
      total_weight_kg: 1,
      points: [
        {
          address: storeAddress,
          latitude: storeLat,
          longitude: storeLng,
          contact_person: { name: storeName, phone: storePhone },
        },
        {
          address: address || 'Customer Address',
          latitude: Number(latitude),
          longitude: Number(longitude),
          contact_person: { name: 'Customer', phone: '9000000000' },
        },
      ],
    })

    const order = result.order as Record<string, unknown>
    const fee = order?.payment_amount ? Math.round(Number(order.payment_amount)) : 0

    return NextResponse.json({
      fee,
      payment_amount: order?.payment_amount,
      delivery_fee_amount: order?.delivery_fee_amount,
      warnings: (result.warnings as string[]) ?? [],
    })
  } catch (err: unknown) {
    // Never block checkout on a quote failure — return fee:0 so the user can proceed
    const msg = err instanceof BorzoError ? err.message : 'quote_failed'
    console.error('[borzo/quote]', msg)
    return NextResponse.json({ fee: 0, error: msg })
  }
}
