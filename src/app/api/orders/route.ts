import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ orders: [] })

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*,order_items(*,product:products(id,name,image_url,is_veg))')
    .eq('customer_clerk_id', userId)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: data || [] })
}
