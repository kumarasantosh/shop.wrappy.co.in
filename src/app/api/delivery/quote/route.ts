import { NextResponse } from 'next/server'
import { getDeliveryProvider } from '../../../../lib/delivery'

/**
 * Returns a live courier delivery fee for a dropoff location, used by checkout
 * to show the real fee before payment. The fee is re-quoted authoritatively
 * server-side in /api/orders/create, so this endpoint is display-only.
 */
export async function POST(req: Request) {
  const provider = getDeliveryProvider()
  if (!provider.isConfigured() || !provider.isPickupConfigured()) {
    return NextResponse.json({ error: 'delivery_not_configured' }, { status: 503 })
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

    const quote = await provider.createQuote({
      dropoffAddress: address,
      dropoffLatitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : undefined,
      dropoffLongitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : undefined,
      dropoffPhoneNumber: body.phone ? String(body.phone) : undefined,
      subtotalRupees: Number.isFinite(Number(body.subtotal)) ? Number(body.subtotal) : undefined,
    })

    return NextResponse.json({
      provider: provider.name,
      quoteId: quote.quoteId,
      fee: quote.feeRupees,
      currency: quote.currency,
      etaMinutes: quote.etaMinutes,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'quote_failed', message: (err && err.message) || 'error' },
      { status: 502 }
    )
  }
}
