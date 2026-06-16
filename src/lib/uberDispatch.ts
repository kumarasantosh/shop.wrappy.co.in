import { supabaseAdmin } from './supabaseAdmin'
import {
  createDelivery,
  isUberDirectConfigured,
  isUberPickupConfigured,
  type UberManifestItem,
} from './uberDirect'

const PICKUP_ADDRESS_SENTINEL = 'Self Pickup at Store'

export type DispatchResult =
  | { ok: true; deliveryId: string; trackingUrl?: string; status: string }
  | { ok: false; reason: string; message?: string }

/**
 * Creates an Uber Direct delivery for a stored order and persists the
 * returned delivery id / tracking url / status back onto the order row.
 *
 * Designed to be safe to call from request handlers: it never throws — every
 * failure is returned as { ok: false, reason }. It is also idempotent: if the
 * order already has an uber_delivery_id, it returns that without re-dispatching.
 */
export async function dispatchUberDeliveryForOrder(orderId: string): Promise<DispatchResult> {
  if (!isUberDirectConfigured() || !isUberPickupConfigured()) {
    return { ok: false, reason: 'uber_not_configured' }
  }

  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) {
    return { ok: false, reason: 'no_database' }
  }

  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('*,order_items(qty,price,product:products(name))')
      .eq('id', orderId)
      .maybeSingle()

    if (error || !order) {
      return { ok: false, reason: 'order_not_found', message: error?.message }
    }

    // Already dispatched — idempotent no-op.
    if (order.uber_delivery_id) {
      return {
        ok: true,
        deliveryId: order.uber_delivery_id,
        trackingUrl: order.uber_tracking_url || undefined,
        status: order.uber_status || 'existing',
      }
    }

    // Pickup orders are never dispatched to a courier.
    if (!order.address || order.address === PICKUP_ADDRESS_SENTINEL) {
      return { ok: false, reason: 'not_a_delivery_order' }
    }

    if (!order.phone) {
      return { ok: false, reason: 'missing_dropoff_phone' }
    }

    const manifestItems: UberManifestItem[] = (order.order_items || []).map((row: any) => ({
      name: String(row?.product?.name || 'Item'),
      quantity: Number(row?.qty || 1),
      price: Number(row?.price || 0),
      size: 'small',
    }))

    if (manifestItems.length === 0) {
      manifestItems.push({ name: 'Food order', quantity: 1, size: 'small' })
    }

    const dropoffLat =
      order.dropoff_latitude !== null && order.dropoff_latitude !== undefined
        ? Number(order.dropoff_latitude)
        : undefined
    const dropoffLng =
      order.dropoff_longitude !== null && order.dropoff_longitude !== undefined
        ? Number(order.dropoff_longitude)
        : undefined

    const delivery = await createDelivery({
      quoteId: order.uber_quote_id || undefined,
      dropoffName: 'Wrappy Customer',
      dropoffAddress: String(order.address),
      dropoffPhoneNumber: String(order.phone),
      dropoffLatitude: Number.isFinite(dropoffLat) ? dropoffLat : undefined,
      dropoffLongitude: Number.isFinite(dropoffLng) ? dropoffLng : undefined,
      dropoffNotes: order.instructions ? String(order.instructions) : undefined,
      manifestReference: String(order.id),
      manifestItems,
      manifestTotalRupees: Number(order.subtotal || 0),
    })

    await supabaseAdmin
      .from('orders')
      .update({
        uber_delivery_id: delivery.id,
        uber_tracking_url: delivery.trackingUrl || null,
        uber_status: delivery.status || null,
        uber_fee:
          delivery.feeRupees !== undefined ? delivery.feeRupees : order.uber_fee || 0,
      })
      .eq('id', order.id)

    return {
      ok: true,
      deliveryId: delivery.id,
      trackingUrl: delivery.trackingUrl,
      status: delivery.status,
    }
  } catch (err: any) {
    console.error('Uber Direct dispatch failed:', err)
    return { ok: false, reason: 'dispatch_error', message: (err && err.message) || 'error' }
  }
}
