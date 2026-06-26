/**
 * POST /api/borzo/cancel-order
 *
 * Cancels a Borzo delivery order.
 * Only allowed while status is: new | available | active | delayed
 * and no courier has visited any address yet.
 *
 * Body: { order_id: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { BorzoError, cancelOrder } from '../../../../lib/borzo'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const orderId = Number(body.order_id)

    if (!orderId) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
    }

    const result = await cancelOrder(orderId)
    const order = result.order as Record<string, unknown>

    // Sync cancelled status back to Wrappy orders table
    supabaseAdmin
      .from('orders')
      .update({ borzo_status: 'canceled' })
      .eq('borzo_order_id', orderId)
      .then(({ error }) => {
        if (error) console.error('[Borzo] cancel status sync failed:', error.message)
      })

    return NextResponse.json({ order })
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
