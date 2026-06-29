import { NextResponse } from 'next/server'
import { getAccessScope } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getBranchProductMap } from '../../../../lib/branchesServer'

function hasSupabase() {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}

function canManageBranch(scope: Awaited<ReturnType<typeof getAccessScope>>, branchId: string) {
  if (scope.isSuperAdmin) return true
  return scope.branchIds.includes(branchId)
}

/**
 * Admin view of a branch's menu: every catalogue product merged with the
 * branch's availability + price override.
 */
export async function GET(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ items: [] })

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get('branchId') || ''
  if (!branchId) return NextResponse.json({ error: 'branch_required' }, { status: 400 })
  if (!canManageBranch(scope, branchId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [{ data: products, error: prodErr }, overrideMap] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id,name,price,is_veg,image_url,category:categories(id,name,position)')
      .order('name', { ascending: true }),
    getBranchProductMap(branchId),
  ])
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })

  const items = (products || []).map((p: any) => {
    const ov = overrideMap.get(String(p.id))
    return {
      product_id: p.id,
      name: p.name,
      base_price: Number(p.price),
      is_veg: p.is_veg,
      image_url: p.image_url,
      category: p.category?.name || '',
      branch_available: ov ? ov.is_available : true,
      price_override: ov?.price_override ?? null,
    }
  })

  return NextResponse.json({ items })
}

// Toggle availability / set price override for one product at a branch.
export async function PATCH(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const body = (await req.json()) as {
    branch_id?: string
    product_id?: string
    is_available?: boolean
    price_override?: number | null
  }
  const branchId = String(body.branch_id || '')
  const productId = String(body.product_id || '')
  if (!branchId || !productId) return NextResponse.json({ error: 'branch_and_product_required' }, { status: 400 })
  if (!canManageBranch(scope, branchId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const payload: Record<string, unknown> = {
    branch_id: branchId,
    product_id: productId,
  }
  if (body.is_available !== undefined) payload.is_available = Boolean(body.is_available)
  if (body.price_override !== undefined) {
    payload.price_override =
      body.price_override == null || Number(body.price_override) <= 0
        ? null
        : Number(body.price_override)
  }

  const { data, error } = await supabaseAdmin
    .from('branch_products')
    .upsert(payload, { onConflict: 'branch_id,product_id' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
