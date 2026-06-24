import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { parseOrderMeta, appendOrderMeta } from '../../../../lib/orderMeta'

/**
 * POST /api/delivery/pidge-webhook
 *
 * Pidge calls this endpoint with delivery status updates.
 * Configure this URL in your Pidge Dashboard → Settings → Channel Integration → Webhook URL.
 *
 * Set PIDGE_WEBHOOK_SECRET in .env.local and enter the same value as Auth Token in Pidge.
 *
 * Expected body from Pidge:
 * {
 *   channel_order_id: string,  // our order.id
 *   order_id: string,          // pidge's internal order id
 *   status: string,            // see PIDGE_STATUS_MAP below
 *   timestamp?: string
 * }
 */

const WEBHOOK_SECRET = process.env.PIDGE_WEBHOOK_SECRET || ''

// Map Pidge statuses → our internal order status
const PIDGE_STATUS_MAP: Record<string, string> = {
  ORDER_CREATED: 'out_for_delivery',
  RIDER_ASSIGNED: 'out_for_delivery',
  PICKED_UP: 'out_for_delivery',
  IN_TRANSIT: 'out_for_delivery',
  DELIVERED: 'delivered',
  // FAILED / UNDELIVERED leave order in out_for_delivery for admin to handle
}

export async function POST(req: Request) {
  try {
    // Verify webhook secret if configured
    if (WEBHOOK_SECRET) {
      const authHeader =
        req.headers.get('authorization') || req.headers.get('x-auth-token') || ''
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader
      if (token !== WEBHOOK_SECRET) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    const body = (await req.json()) as {
      channel_order_id?: string
      order_id?: string
      status?: string
      timestamp?: string
    }

    const channelOrderId = String(body.channel_order_id || '').trim()
    const pidgeStatus = String(body.status || '').toUpperCase().trim()

    if (!channelOrderId || !pidgeStatus) {
      return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
    }

    const ourStatus = PIDGE_STATUS_MAP[pidgeStatus]

    // Unknown / unhandled status — acknowledge without updating
    if (!ourStatus) {
      console.log(`[PidgeWebhook] Unhandled status "${pidgeStatus}" for order ${channelOrderId}`)
      return NextResponse.json({ ok: true })
    }

    const updatePayload: Record<string, unknown> = { status: ourStatus }
    if (ourStatus === 'delivered') {
      updatePayload.delivery_time = new Date().toISOString()
      updatePayload.payment_status = 'paid'
    }

    // If Pidge returned their order_id, store it in instructions meta
    const pidgeOrderId = String(body.order_id || '').trim()
    if (pidgeOrderId) {
      // Fetch current instructions to merge
      const { data: orderRow } = await supabaseAdmin
        .from('orders')
        .select('instructions')
        .eq('id', channelOrderId)
        .maybeSingle()

      if (orderRow) {
        const meta = parseOrderMeta(orderRow.instructions)
        const updatedInstructions = appendOrderMeta(orderRow.instructions, {
          ...meta,
          pidgeOrderId,
        })
        updatePayload.instructions = updatedInstructions
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

    console.log(`[PidgeWebhook] Order ${channelOrderId} → ${ourStatus}`)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'error'
    console.error('[PidgeWebhook] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
