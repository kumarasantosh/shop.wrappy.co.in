/**
 * POST /api/borzo/callback
 *
 * Public webhook endpoint for Borzo status callbacks.
 * Register this URL in your Borzo cabinet → Integration tab.
 *
 * IMPORTANT: Must respond 2xx quickly. Borzo retries for 24 h on any
 * 4xx/5xx response — so we acknowledge first, then process.
 *
 * Borzo sends two distinct callback shapes:
 *   - Order callback:    { order: { order_id, status, ... } }
 *   - Delivery callback: { delivery: { delivery_id, status, order_id, ... } }
 *
 * Signature verification uses BORZO_CALLBACK_TOKEN from env (set in Borzo cabinet).
 * If the token is not configured, signature checking is skipped (dev only).
 *
 * Wrappy order status mapping:
 *   Borzo order status       → Wrappy order status
 *   new | available | active → out_for_delivery
 *   completed                → delivered
 *   canceled                 → cancelled
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseCallback, verifyCallbackSignature } from '../../../../lib/borzo'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

// Map Borzo order statuses to Wrappy order statuses
function toWrappyStatus(
  borzoStatus: string
): 'out_for_delivery' | 'delivered' | 'cancelled' | null {
  switch (borzoStatus) {
    case 'new':
    case 'available':
    case 'active':
    case 'delayed':
      return 'out_for_delivery'
    case 'completed':
      return 'delivered'
    case 'canceled':
      return 'cancelled'
    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  // Read raw body first — needed for HMAC verification
  const rawBody = await req.text()

  // Always acknowledge fast so Borzo stops retrying
  // We do heavy work after sending the response (fire-and-forget pattern)
  const respond = (status = 200) =>
    new NextResponse(JSON.stringify({ received: true }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  // Verify HMAC signature (skip if BORZO_CALLBACK_TOKEN not set — dev mode)
  const callbackToken = process.env.BORZO_CALLBACK_TOKEN
  if (callbackToken) {
    const signature = req.headers.get('x-dv-signature') ?? ''
    if (!verifyCallbackSignature(rawBody, signature)) {
      console.warn('[Borzo callback] Invalid HMAC signature — rejected')
      return respond(403)
    }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return respond(400)
  }

  const event = parseCallback(body)
  console.log(`[Borzo callback] type=${event.type}`, JSON.stringify(event.data))

  // Process asynchronously — do not await so the 2xx response fires immediately
  processCallback(event).catch((err) =>
    console.error('[Borzo callback] processing error:', err)
  )

  return respond(200)
}

async function processCallback(event: ReturnType<typeof parseCallback>) {
  if (event.type === 'order') {
    const data = event.data as Record<string, unknown>
    const borzoOrderId = data.order_id as number
    const borzoStatus = data.status as string

    if (!borzoOrderId) return

    const wrappyStatus = toWrappyStatus(borzoStatus)

    // Update borzo_status (always) and order status (when mappable)
    const updates: Record<string, unknown> = { borzo_status: borzoStatus }
    if (wrappyStatus) updates.status = wrappyStatus

    const { error } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('borzo_order_id', borzoOrderId)

    if (error) {
      console.error('[Borzo callback] order update failed:', error.message)
    } else {
      console.log(
        `[Borzo callback] order #${borzoOrderId} → borzo:${borzoStatus}`,
        wrappyStatus ? `/ wrappy:${wrappyStatus}` : ''
      )
    }
  }

  if (event.type === 'delivery') {
    const data = event.data as Record<string, unknown>
    const deliveryStatus = data.status as string
    const borzoOrderId = data.order_id as number | undefined

    console.log(
      `[Borzo callback] delivery status=${deliveryStatus}`,
      borzoOrderId ? `order_id=${borzoOrderId}` : ''
    )

    // Delivery callbacks carry the parent order_id — use it if present
    if (borzoOrderId && deliveryStatus === 'finished') {
      await supabaseAdmin
        .from('orders')
        .update({ borzo_status: 'completed', status: 'delivered' })
        .eq('borzo_order_id', borzoOrderId)
        .then(({ error }) => {
          if (error) console.error('[Borzo callback] delivery finish update failed:', error.message)
        })
    }

    // TODO: Add additional delivery-level logic here (e.g. notify customer,
    // update per-point delivery records, send WhatsApp message, etc.)
  }
}
