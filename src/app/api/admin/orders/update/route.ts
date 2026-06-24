import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { sendWhatsAppTemplate } from '../../../../../lib/whatsapp'
import { parseOrderMeta, appendOrderMeta } from '../../../../../lib/orderMeta'
import { createPidgeOrder } from '../../../../../lib/pidge'

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

  // ── WhatsApp: notify customer when order is accepted ──────────────────────
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
      // Never block order flow
    }
  }

  // ── Pidge: dispatch a delivery rider when food is marked ready ─────────────
  // Triggers on "Mark Ready" (out_for_delivery) for delivery-type orders only.
  if (status === 'out_for_delivery' && data) {
    const meta = parseOrderMeta(data.instructions)

    if (meta.orderType === 'delivery' && !meta.pidgeOrderId) {
      // Fire-and-forget — never blocks the response
      ;(async () => {
        try {
          const customerPhone = String(data.phone || '').replace(/\D/g, '').slice(-10)
          const dropAddress = String(data.address || '').trim()
          const itemCount = (data as any).order_items?.length ?? 1

          const pidgeRes = await createPidgeOrder({
            orderId: String(data.id),
            customerName: 'Customer',
            customerPhone,
            deliveryAddress: dropAddress,
            deliveryLat: meta.deliveryLat,
            deliveryLng: meta.deliveryLng,
            billAmount: Number(data.total || 0),
            itemCount,
          })

          const pidgeOrderId = pidgeRes.pidgeId

          if (pidgeOrderId) {
            const updatedInstructions = appendOrderMeta(data.instructions, {
              ...meta,
              pidgeOrderId,
            })
            await supabaseAdmin
              .from('orders')
              .update({ instructions: updatedInstructions })
              .eq('id', data.id)
          }

          console.log(
            `[Pidge] Order dispatched for #${String(data.id).slice(0, 8)} → pidge_id=${pidgeOrderId}`
          )
        } catch (err) {
          console.error('[Pidge] Failed to create delivery order:', JSON.stringify(err, Object.getOwnPropertyNames(err)))
          // Log failure but never surface to admin UI
        }
      })()
    }
  }

  return NextResponse.json({ order: data })
}
