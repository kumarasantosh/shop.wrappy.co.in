import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'

// Returns a single order (with its items + product) by id.
// Used by the admin orders panel to hydrate an order that arrives
// over the realtime socket as a bare INSERT (the postgres_changes
// payload does not include joined order_items / product rows).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ order: null })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*,order_items(*,product:products(id,name,image_url,is_veg))')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ order: data || null })
}
