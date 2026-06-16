import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import {
  mapUberStatusToOrderStatus,
  verifyUberWebhookSignature,
} from '../../../../lib/uberDirect'

/**
 * Receives Uber Direct delivery webhooks and syncs the order status.
 *
 * Configure this URL in the Uber Direct dashboard (Developer > Webhooks):
 *   https://<your-domain>/api/uber/webhook
 * Uber signs each request with HMAC-SHA256 of the raw body in the
 * `x-uber-signature` header, verified with UBER_DIRECT_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature =
    req.headers.get('x-uber-signature') ||
    req.headers.get('x-postmates-signature') ||
    ''

  if (!verifyUberWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, reason: 'invalid_signature' }, { status: 401 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 })
  }

  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) {
    return NextResponse.json({ ok: true, note: 'no_database' })
  }

  // Uber's payload shape varies by event kind; pull fields defensively.
  const data = event?.data || event?.delivery || {}
  const deliveryId: string =
    data?.id || event?.delivery_id || event?.meta?.resource_id || ''
  const externalId: string = data?.external_id || event?.external_id || ''
  const uberStatus: string =
    data?.status || event?.status || event?.meta?.status || ''
  const trackingUrl: string | undefined = data?.tracking_url || undefined

  if (!deliveryId && !externalId) {
    return NextResponse.json({ ok: true, note: 'no_identifier' })
  }

  try {
    // Locate the order by Uber delivery id first, then by our order id.
    let query = supabaseAdmin.from('orders').select('id,status')
    query = deliveryId
      ? query.eq('uber_delivery_id', deliveryId)
      : query.eq('id', externalId)
    const { data: order } = await query.maybeSingle()

    if (!order && externalId) {
      const { data: byOrderId } = await supabaseAdmin
        .from('orders')
        .select('id,status')
        .eq('id', externalId)
        .maybeSingle()
      if (byOrderId) {
        await applyUpdate(byOrderId, uberStatus, trackingUrl, deliveryId)
        return NextResponse.json({ ok: true })
      }
    }

    if (!order) {
      return NextResponse.json({ ok: true, note: 'order_not_found' })
    }

    await applyUpdate(order, uberStatus, trackingUrl, deliveryId)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Uber webhook update error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

async function applyUpdate(
  order: { id: string; status: string },
  uberStatus: string,
  trackingUrl: string | undefined,
  deliveryId: string
) {
  const update: Record<string, unknown> = {}
  if (uberStatus) update.uber_status = uberStatus
  if (trackingUrl) update.uber_tracking_url = trackingUrl
  if (deliveryId) update.uber_delivery_id = deliveryId

  // Advance the order status, but never move backward from a terminal state.
  const mapped = mapUberStatusToOrderStatus(uberStatus)
  const terminal = order.status === 'delivered' || order.status === 'cancelled'
  if (mapped && !terminal) {
    update.status = mapped
    if (mapped === 'delivered') {
      update.delivery_time = new Date().toISOString()
    }
  }

  if (Object.keys(update).length === 0) return
  await supabaseAdmin.from('orders').update(update).eq('id', order.id)
}
