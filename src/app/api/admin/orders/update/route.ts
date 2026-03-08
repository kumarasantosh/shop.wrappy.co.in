import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'

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

  return NextResponse.json({ order: data })
}
