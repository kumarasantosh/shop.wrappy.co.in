import { NextResponse } from 'next/server'
import {
  createQuote,
  isUberDirectConfigured,
  isUberPickupConfigured,
} from '../../../../lib/uberDirect'

/**
 * Returns a live Uber Direct delivery fee for a dropoff location.
 * Used by the checkout page to show the customer the real delivery fee
 * before they pay. The fee is re-quoted authoritatively server-side in
 * /api/orders/create, so this endpoint is display-only.
 */
export async function POST(req: Request) {
  if (!isUberDirectConfigured() || !isUberPickupConfigured()) {
    return NextResponse.json({ error: 'uber_direct_not_configured' }, { status: 503 })
  }

  try {
    const body = (await req.json()) as {
      address?: string
      latitude?: number
      longitude?: number
      phone?: string
      subtotal?: number
    }

    const address = String(body.address || '').trim()
    if (!address) {
      return NextResponse.json({ error: 'address_required' }, { status: 400 })
    }

    const quote = await createQuote({
      dropoffAddress: address,
      dropoffLatitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : undefined,
      dropoffLongitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : undefined,
      dropoffPhoneNumber: body.phone ? String(body.phone) : undefined,
      manifestTotalRupees: Number.isFinite(Number(body.subtotal)) ? Number(body.subtotal) : undefined,
    })

    return NextResponse.json({
      quoteId: quote.id,
      fee: quote.feeRupees,
      currency: quote.currency,
      dropoffEta: quote.dropoffEta,
      durationMinutes: quote.durationMinutes,
      expiresAt: quote.expiresAt,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'quote_failed', message: (err && err.message) || 'error' },
      { status: 502 }
    )
  }
}
