import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { notifyAdminsUnacceptedOrder } from '../../../../lib/whatsapp'

const UNACCEPTED_THRESHOLD_MINUTES = 5

/**
 * Fire-and-forget: check for unaccepted orders older than 5 min
 * and send WhatsApp notifications to admin phones.
 */
async function checkUnacceptedOrders() {
  try {
    const thresholdDate = new Date(
      Date.now() - UNACCEPTED_THRESHOLD_MINUTES * 60_000
    ).toISOString()

    const { data: pending } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('status', 'placed')
      .is('admin_notified_at', null)
      .lt('created_at', thresholdDate)
      .limit(10)

    if (!pending || pending.length === 0) return

    for (const order of pending) {
      await notifyAdminsUnacceptedOrder(order.id)
      await supabaseAdmin
        .from('orders')
        .update({ admin_notified_at: new Date().toISOString() })
        .eq('id', order.id)
    }
  } catch (err) {
    console.error('[Admin Orders] WhatsApp notification check failed:', err)
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ orders: [] })

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*,order_items(*,product:products(id,name,image_url,is_veg))')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire-and-forget: check for unaccepted orders & notify admins via WhatsApp
  checkUnacceptedOrders().catch(() => { })

  return NextResponse.json({ orders: data || [] })
}
