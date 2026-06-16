import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getDeliveryProvider } from '../../../../lib/delivery'

/**
 * Receives Porter order webhooks and syncs the order status.
 *
 * Configure this URL in your Porter dashboard / partner onboarding:
 *   https://<your-domain>/api/porter/webhook
 * Porter fires events on: accepted, live, ended, reopened, cancelled.
 */
export async function POST(req: Request) {
  const provider = getDeliveryProvider()
  const rawBody = await req.text()

  if (!provider.verifyWebhook(rawBody, req.headers)) {
    return NextResponse.json({ ok: false, reason: 'invalid_signature' }, { status: 401 })
  }

  let event: any
  try {
    event = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 })
  }

  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) {
    return NextResponse.json({ ok: true, note: 'no_database' })
  }

  const parsed = provider.parseWebhook(event)
  if (!parsed.deliveryId && !parsed.externalId) {
    return NextResponse.json({ ok: true, note: 'no_identifier' })
  }

  try {
    // Find the order by courier order id, then by our order id (request_id).
    let order: { id: string; status: string } | null = null

    if (parsed.deliveryId) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id,status')
        .eq('courier_order_id', parsed.deliveryId)
        .maybeSingle()
      order = data
    }

    if (!order && parsed.externalId) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id,status')
        .eq('id', parsed.externalId)
        .maybeSingle()
      order = data
    }

    if (!order) {
      return NextResponse.json({ ok: true, note: 'order_not_found' })
    }

    const update: Record<string, unknown> = {}
    if (parsed.rawStatus) update.courier_status = parsed.rawStatus
    if (parsed.trackingUrl) update.courier_tracking_url = parsed.trackingUrl
    if (parsed.deliveryId) update.courier_order_id = parsed.deliveryId

    const terminal = order.status === 'delivered' || order.status === 'cancelled'
    if (parsed.mappedStatus && !terminal) {
      update.status = parsed.mappedStatus
      if (parsed.mappedStatus === 'delivered') {
        update.delivery_time = new Date().toISOString()
      }
    }

    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from('orders').update(update).eq('id', order.id)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Porter webhook update error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
