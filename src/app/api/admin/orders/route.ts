import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

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
  return NextResponse.json({ orders: data || [] })
}
