import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { sendWhatsAppTemplate } from '../../../../../lib/whatsapp'

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

  return NextResponse.json({ order: data })
}
