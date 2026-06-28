import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { sendWhatsAppTemplate } from '../../../../../lib/whatsapp'
import { createOrder as borzoCreateOrder, BorzoError } from '../../../../../lib/borzo'

type Status =
  | 'placed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ order: null })

  const body = (await req.json()) as { id?: string; status?: Status }
  const { id, status } = body
  if (!id || !status) return NextResponse.json({ error: 'missing' }, { status: 400 })

  const payload: Record<string, unknown> = { status }
  if (status === 'delivered') {
    payload.delivery_time = new Date().toISOString()
    payload.payment_status = 'paid'
  }
  if (status === 'cancelled') {
    payload.payment_status = 'failed'
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // When order is accepted (preparing), send WhatsApp to customer (fire-and-forget, never blocks)
  if (status === 'preparing' && data) {
    try {
      let customerPhone: string | null = data.phone || null

      if (!customerPhone && data.customer_clerk_id) {
        const { data: cp } = await supabaseAdmin
          .from('customer_phones')
          .select('phone')
          .eq('customer_clerk_id', data.customer_clerk_id)
          .limit(1)
          .maybeSingle()
        customerPhone = cp?.phone || null
      }

      if (customerPhone) {
        sendWhatsAppTemplate(customerPhone, 'hello_world').catch(() => { })
      }
    } catch {
      // silently ignore — WhatsApp notification must never block order flow
    }
  }

  // When order is accepted (preparing), dispatch Borzo for delivery orders (fire-and-forget)
  if (status === 'preparing' && data) {
    const lat = (data as Record<string, unknown>).dropoff_latitude as number | null | undefined
    const lng = (data as Record<string, unknown>).dropoff_longitude as number | null | undefined

    if (lat && lng) {
      const storeLat = Number(process.env.STORE_LATITUDE || process.env.PORTER_PICKUP_LATITUDE || 0)
      const storeLng = Number(process.env.STORE_LONGITUDE || process.env.PORTER_PICKUP_LONGITUDE || 0)
      const storeAddress = process.env.PORTER_PICKUP_ADDRESS || 'Wrappy, Kukatpally, Hyderabad'
      const storeName = process.env.PORTER_PICKUP_NAME || 'Wrappy'
      const storePhone = process.env.PORTER_PICKUP_PHONE || '9182285342'
      const customerPhone = (data.phone as string | null) || storePhone

      if (storeLat && storeLng) {
        borzoCreateOrder({
          type: 'standard',
          matter: 'Food',
          total_weight_kg: 1,
          is_contact_person_notification_enabled: true,
          is_client_notification_enabled: true,
          points: [
            {
              address: storeAddress,
              latitude: storeLat,
              longitude: storeLng,
              contact_person: { name: storeName, phone: storePhone },
            },
            {
              address: (data.address as string | null) || 'Customer Address',
              latitude: lat,
              longitude: lng,
              contact_person: { name: 'Customer', phone: customerPhone },
            },
          ],
        })
          .then(async (result) => {
            const borzoOrder = result.order as Record<string, unknown>
            const borzoOrderId = borzoOrder?.order_id
            const trackingUrl = (borzoOrder?.tracking_url as string) || null
            const trackingUrls = borzoOrder?.tracking_urls ?? null
            if (borzoOrderId) {
              const { error } = await supabaseAdmin
                .from('orders')
                .update({
                  borzo_order_id: borzoOrderId,
                  borzo_status: (borzoOrder?.status as string) || 'new',
                  borzo_tracking_url: trackingUrl,
                  borzo_tracking_urls: trackingUrls,
                })
                .eq('id', id)
              if (error) console.error('[update] Borzo order_id save failed:', error.message)
              else console.log(`[update] Borzo dispatched: borzo_order_id=${borzoOrderId} wrappy_order_id=${id}`)
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof BorzoError ? err.message : String(err)
            console.error('[update] Borzo createOrder error:', msg)
          })
      }
    }
  }

  return NextResponse.json({ order: data })
}
