import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { parseOrderMeta, appendOrderMeta } from '../../../../lib/orderMeta'

/**
 * POST /api/delivery/pidge-webhook
 *
 * Pidge sends the full order object here on status changes.
 * Configure in Pidge Dashboard → Settings → Channel Integration → Webhook URL.
 * Set PIDGE_WEBHOOK_SECRET to the Auth Token you enter in Pidge.
 *
 * Pidge webhook payload (top-level keys):
 *   id                — Pidge's internal order ID
 *   dd_channel.order_id — our source_order_id (our order UUID)
 *   status            — parent status: pending | fulfilled | completed | cancelled
 *   fulfillment.status — granular status: CREATED | OUT_FOR_PICKUP | PICKED_UP |
 *                        OUT_FOR_DELIVERY | REACHED_DELIVERY | DELIVERED | etc.
 */

const WEBHOOK_SECRET = process.env.PIDGE_WEBHOOK_SECRET || ''

// Map Pidge fulfillment statuses → our order status
const FULFILLMENT_STATUS_MAP: Record<string, string> = {
  CREATED:              'out_for_delivery',
  OUT_FOR_PICKUP:       'out_for_delivery',
  REACHED_PICKUP:       'out_for_delivery',
  PICKED_UP:            'out_for_delivery',
  IN_TRANSIT:           'out_for_delivery',
  OUT_FOR_DELIVERY:     'out_for_delivery',
  REACHED_DELIVERY:     'out_for_delivery',
  DELIVERED:            'delivered',
  UNDELIVERED:          'out_for_delivery',
  RTO_OUT_FOR_DELIVERY: 'out_for_delivery',
  RTO_DELIVERED:        'out_for_delivery',
}

export async function POST(req: Request) {
  try {
    // Verify webhook secret if configured
    if (WEBHOOK_SECRET) {
      const authHeader = req.headers.get('authorization') || req.headers.get('x-auth-token') || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
      if (token !== WEBHOOK_SECRET) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    const body = (await req.json()) as {
      id?: string                         // Pidge order ID
      dd_channel?: { order_id?: string }  // our source_order_id
      status?: string                     // parent status
      fulfillment?: { status?: string }   // granular status
    }

    const pidgeId = String(body.id || '').trim()
    // dd_channel.order_id is the source_order_id we sent — our order UUID
    const channelOrderId = String(body.dd_channel?.order_id || '').trim()
    const fulfillmentStatus = String(
      body.fulfillment?.status || body.status || ''
    ).toUpperCase().trim()

    if (!channelOrderId) {
      console.log('[PidgeWebhook] Missing dd_channel.order_id, ignoring payload')
      return NextResponse.json({ ok: true })
    }

    const ourStatus = FULFILLMENT_STATUS_MAP[fulfillmentStatus]

    if (!ourStatus) {
      console.log(`[PidgeWebhook] Unhandled status "${fulfillmentStatus}" for order ${channelOrderId}`)
      return NextResponse.json({ ok: true })
    }

    const updatePayload: Record<string, unknown> = { status: ourStatus }
    if (ourStatus === 'delivered') {
      updatePayload.delivery_time = new Date().toISOString()
      updatePayload.payment_status = 'paid'
    }

    // Store Pidge order ID in instructions meta if not already saved
    if (pidgeId) {
      const { data: orderRow } = await supabaseAdmin
        .from('orders')
        .select('instructions')
        .eq('id', channelOrderId)
        .maybeSingle()

      if (orderRow) {
        const meta = parseOrderMeta(orderRow.instructions)
        if (!meta.pidgeOrderId) {
          updatePayload.instructions = appendOrderMeta(orderRow.instructions, {
            ...meta,
            pidgeOrderId: pidgeId,
          })
        }
      }
    }

    const { error } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('id', channelOrderId)

    if (error) {
      console.error('[PidgeWebhook] Supabase update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[PidgeWebhook] Order ${channelOrderId} → ${ourStatus} (pidge: ${fulfillmentStatus})`)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'error'
    console.error('[PidgeWebhook] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
