import { supabaseAdmin } from './supabaseAdmin'
import { getDeliveryProvider, type DeliveryItem } from './delivery'

const PICKUP_ADDRESS_SENTINEL = 'Self Pickup at Store'

export type DispatchResult =
  | { ok: true; deliveryId: string; trackingUrl?: string; status: string }
  | { ok: false; reason: string; message?: string }

/**
 * Creates a courier delivery for a stored order via the active provider and
 * persists the returned id / tracking url / status back onto the order row.
 *
 * Never throws — every failure is returned as { ok: false, reason }. Idempotent:
 * if the order already has a courier_order_id, it returns that without
 * re-dispatching.
 */
export async function dispatchDeliveryForOrder(orderId: string): Promise<DispatchResult> {
  const provider = getDeliveryProvider()

  if (!provider.isConfigured() || !provider.isPickupConfigured()) {
    return { ok: false, reason: 'courier_not_configured' }
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
    if (order.courier_order_id) {
      return {
        ok: true,
        deliveryId: order.courier_order_id,
        trackingUrl: order.courier_tracking_url || undefined,
        status: order.courier_status || 'existing',
      }
    }

    // Pickup orders are never dispatched to a courier.
    if (!order.address || order.address === PICKUP_ADDRESS_SENTINEL) {
      return { ok: false, reason: 'not_a_delivery_order' }
    }

    if (!order.phone) {
      return { ok: false, reason: 'missing_dropoff_phone' }
    }

    const items: DeliveryItem[] = (order.order_items || []).map((row: any) => ({
      name: String(row?.product?.name || 'Item'),
      quantity: Number(row?.qty || 1),
      priceRupees: Number(row?.price || 0),
    }))

    if (items.length === 0) {
      items.push({ name: 'Food order', quantity: 1 })
    }

    const dropoffLat =
      order.dropoff_latitude !== null && order.dropoff_latitude !== undefined
        ? Number(order.dropoff_latitude)
        : undefined
    const dropoffLng =
      order.dropoff_longitude !== null && order.dropoff_longitude !== undefined
        ? Number(order.dropoff_longitude)
        : undefined

    const delivery = await provider.createDelivery({
      quoteId: order.courier_quote_id || undefined,
      orderId: String(order.id),
      dropoffName: 'Wrappy Customer',
      dropoffAddress: String(order.address),
      dropoffPhoneNumber: String(order.phone),
      dropoffLatitude: Number.isFinite(dropoffLat) ? dropoffLat : undefined,
      dropoffLongitude: Number.isFinite(dropoffLng) ? dropoffLng : undefined,
      dropoffNotes: order.instructions ? String(order.instructions) : undefined,
      items,
      subtotalRupees: Number(order.subtotal || 0),
    })

    await supabaseAdmin
      .from('orders')
      .update({
        delivery_provider: provider.name,
        courier_order_id: delivery.id,
        courier_tracking_url: delivery.trackingUrl || null,
        courier_status: delivery.status || null,
        courier_fee:
          delivery.feeRupees !== undefined ? delivery.feeRupees : order.courier_fee || 0,
      })
      .eq('id', order.id)

    return {
      ok: true,
      deliveryId: delivery.id,
      trackingUrl: delivery.trackingUrl,
      status: delivery.status,
    }
  } catch (err: any) {
    console.error('Courier dispatch failed:', err)
    return { ok: false, reason: 'dispatch_error', message: (err && err.message) || 'error' }
  }
}
