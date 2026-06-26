/**
 * POST /api/borzo/create-order
 *
 * Places a Borzo delivery order. At this stage all errors are critical —
 * they block order creation (no partial success unlike calculate-order).
 *
 * On success, stores borzo_order_id + borzo_tracking_url(s) onto the matching
 * Wrappy order in Supabase (if wrappy_order_id is provided in the body).
 *
 * Body:
 * {
 *   // Required delivery details — same shape as calculate-order
 *   pickup:   { address, latitude, longitude, name, phone, note?, client_order_id? }
 *   dropoffs: [{ address, latitude, longitude, name, phone, note?, client_order_id? }]
 *   matter?:     string   // "Food" default
 *   weight_kg?:  number
 *   type?:       "standard" | "endofday"
 *   vehicle_type_id?: number  // 8 = bike (India default)
 *   insurance_amount?: number
 *   cod?: { enabled: boolean; taking_amount?: string }
 *
 *   // Optional: link this Borzo order to an existing Wrappy order
 *   wrappy_order_id?: string
 * }
 *
 * Alternatively pass a raw `points` array.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  BorzoError,
  BorzoOrderParams,
  buildPoints,
  createOrder,
} from '../../../../lib/borzo'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    let params: BorzoOrderParams

    if (Array.isArray(body.points)) {
      params = {
        type: body.type || 'standard',
        matter: body.matter || 'Food',
        vehicle_type_id: body.vehicle_type_id ?? 8,
        total_weight_kg: body.weight_kg ?? body.total_weight_kg ?? 1,
        ...(body.insurance_amount != null
          ? { insurance_amount: body.insurance_amount }
          : {}),
        is_client_notification_enabled: true,
        is_contact_person_notification_enabled: true,
        points: body.points,
      }
    } else if (body.pickup && Array.isArray(body.dropoffs)) {
      const { pickup, dropoffs, type, matter, weight_kg, cod, vehicle_type_id, insurance_amount } =
        body

      if (!pickup.address || pickup.latitude == null || pickup.longitude == null) {
        return NextResponse.json(
          { error: 'pickup must have address, latitude, longitude' },
          { status: 400 }
        )
      }
      if (dropoffs.length === 0) {
        return NextResponse.json(
          { error: 'at least one dropoff is required' },
          { status: 400 }
        )
      }
      if (type === 'endofday' && dropoffs.length !== 1) {
        return NextResponse.json(
          { error: 'endofday orders must have exactly 1 dropoff (2 points total)' },
          { status: 400 }
        )
      }

      params = {
        type: type || 'standard',
        matter: matter || 'Food',
        vehicle_type_id: vehicle_type_id ?? 8,
        total_weight_kg: weight_kg ?? 1,
        ...(insurance_amount != null ? { insurance_amount } : {}),
        is_client_notification_enabled: true,
        is_contact_person_notification_enabled: true,
        points: buildPoints(pickup, dropoffs, cod),
      }
    } else {
      return NextResponse.json(
        { error: 'body must contain either points[] or pickup + dropoffs[]' },
        { status: 400 }
      )
    }

    const result = await createOrder(params)
    const order = result.order as Record<string, unknown>

    // Collect per-point tracking URLs
    const trackingUrls = ((order.points as any[]) || [])
      .filter((p) => p.tracking_url)
      .map((p) => ({ address: p.address as string, url: p.tracking_url as string }))

    const firstTrackingUrl = trackingUrls[0]?.url ?? null
    const borzoOrderId = order.order_id as number

    // Persist Borzo order details onto the matching Wrappy order (fire-and-forget)
    const wrappyOrderId = body.wrappy_order_id as string | undefined
    if (wrappyOrderId) {
      supabaseAdmin
        .from('orders')
        .update({
          borzo_order_id: borzoOrderId,
          borzo_status: order.status,
          borzo_tracking_url: firstTrackingUrl,
          borzo_tracking_urls: trackingUrls,
        })
        .eq('id', wrappyOrderId)
        .then(({ error }) => {
          if (error) console.error('[Borzo] failed to store order id on order:', error.message)
        })
    }

    return NextResponse.json({
      order_id: borzoOrderId,
      order_name: order.order_name,
      status: order.status,
      payment_amount: order.payment_amount,
      tracking_url: firstTrackingUrl,
      tracking_urls: trackingUrls,
      order,
    })
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
