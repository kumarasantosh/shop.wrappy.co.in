/**
 * POST /api/borzo/calculate-order
 *
 * Validates and prices a delivery before the user commits.
 * Borzo returns a price even when there are warnings — surface both to the UI.
 *
 * Body (Wrappy-style):
 * {
 *   pickup: { address, latitude, longitude, name, phone, note? }
 *   dropoffs: [{ address, latitude, longitude, name, phone, note? }]
 *   matter?: string          // e.g. "Food" (default)
 *   weight_kg?: number
 *   type?: "standard" | "endofday"
 * }
 *
 * Alternatively, pass a raw `points` array to forward directly to Borzo.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  BorzoError,
  BorzoOrderParams,
  buildPoints,
  calculateOrder,
} from '../../../../lib/borzo'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    let params: BorzoOrderParams

    if (Array.isArray(body.points)) {
      // Raw Borzo points array passed directly
      params = {
        type: body.type || 'standard',
        matter: body.matter || 'Food',
        total_weight_kg: body.weight_kg ?? body.total_weight_kg ?? 1,
        points: body.points,
      }
    } else if (body.pickup && Array.isArray(body.dropoffs)) {
      // Wrappy-style pickup/dropoffs
      const { pickup, dropoffs, type, matter, weight_kg, cod } = body

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

      params = {
        type: type || 'standard',
        matter: matter || 'Food',
        total_weight_kg: weight_kg ?? 1,
        points: buildPoints(pickup, dropoffs, cod),
      }
    } else {
      return NextResponse.json(
        { error: 'body must contain either points[] or pickup + dropoffs[]' },
        { status: 400 }
      )
    }

    const result = await calculateOrder(params)
    const order = result.order as Record<string, unknown> | null

    return NextResponse.json({
      payment_amount: (order as any)?.payment_amount ?? null,
      delivery_fee: (order as any)?.delivery_fee_amount ?? null,
      warnings: (result.warnings as string[]) || [],
      parameter_warnings: result.parameter_warnings ?? null,
      order_preview: order,
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
