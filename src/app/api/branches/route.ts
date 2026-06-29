import { NextResponse } from 'next/server'
import { getAccessScope } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { BranchRecord } from '../../../lib/branches'

function hasSupabase() {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Public (storefront) list of active branches for the branch picker, plus the
// full list for admins. Pass ?all=1 (admin only) to include inactive branches.
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ branches: [] })

  const { searchParams } = new URL(req.url)
  const wantAll = searchParams.get('all') === '1'

  let query = supabaseAdmin.from('branches').select('*').order('position', { ascending: true })

  if (wantAll) {
    const scope = await getAccessScope()
    if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    if (!scope.isSuperAdmin) query = query.in('id', scope.branchIds.length ? scope.branchIds : ['00000000-0000-0000-0000-000000000000'])
  } else {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const branches = (data as BranchRecord[]) || []
  if (wantAll) return NextResponse.json({ branches })

  // Public payload — only fields the storefront needs.
  return NextResponse.json({
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      address: b.address,
      phone: b.phone,
      latitude: b.latitude,
      longitude: b.longitude,
    })),
  })
}

export async function POST(req: Request) {
  const scope = await getAccessScope()
  if (!scope.isSuperAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const body = (await req.json()) as Partial<BranchRecord>
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const slug = (body.slug && slugify(String(body.slug))) || slugify(name)

  const payload = {
    name,
    slug,
    address: body.address ?? null,
    city: body.city ?? null,
    phone: body.phone ?? null,
    latitude: body.latitude != null ? Number(body.latitude) : null,
    longitude: body.longitude != null ? Number(body.longitude) : null,
    open_time: body.open_time ? `${String(body.open_time).slice(0, 5)}:00` : '10:00:00',
    close_time: body.close_time ? `${String(body.close_time).slice(0, 5)}:00` : '22:00:00',
    allow_preorder: Boolean(body.allow_preorder),
    force_closed: Boolean(body.force_closed),
    estimated_delivery_minutes: Number(body.estimated_delivery_minutes || 30),
    is_active: body.is_active !== false,
    position: Number(body.position || 0),
  }

  const { data, error } = await supabaseAdmin.from('branches').insert([payload]).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed this branch's menu from the master catalogue.
  const { data: products } = await supabaseAdmin.from('products').select('id')
  const links = (products || []).map((p: any) => ({
    branch_id: data.id,
    product_id: p.id,
    is_available: true,
  }))
  if (links.length) {
    await supabaseAdmin.from('branch_products').upsert(links, { onConflict: 'branch_id,product_id' })
  }

  return NextResponse.json({ branch: data })
}

export async function PATCH(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const body = (await req.json()) as Partial<BranchRecord> & { id?: string }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  // Branch admins may edit only their own branch; superadmin may edit any.
  if (!scope.isSuperAdmin) {
    if (!scope.isBranchAdmin || !scope.branchIds.includes(body.id)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const payload: Record<string, unknown> = {}
  if (body.name !== undefined) payload.name = String(body.name).trim()
  if (body.slug !== undefined) payload.slug = slugify(String(body.slug))
  if (body.address !== undefined) payload.address = body.address || null
  if (body.city !== undefined) payload.city = body.city || null
  if (body.phone !== undefined) payload.phone = body.phone || null
  if (body.latitude !== undefined) payload.latitude = body.latitude != null ? Number(body.latitude) : null
  if (body.longitude !== undefined) payload.longitude = body.longitude != null ? Number(body.longitude) : null
  if (body.open_time !== undefined) payload.open_time = `${String(body.open_time).slice(0, 5)}:00`
  if (body.close_time !== undefined) payload.close_time = `${String(body.close_time).slice(0, 5)}:00`
  if (body.allow_preorder !== undefined) payload.allow_preorder = Boolean(body.allow_preorder)
  if (body.force_closed !== undefined) payload.force_closed = Boolean(body.force_closed)
  if (body.estimated_delivery_minutes !== undefined) payload.estimated_delivery_minutes = Number(body.estimated_delivery_minutes)
  if (body.is_active !== undefined && scope.isSuperAdmin) payload.is_active = Boolean(body.is_active)
  if (body.position !== undefined && scope.isSuperAdmin) payload.position = Number(body.position)

  const { data, error } = await supabaseAdmin.from('branches').update(payload).eq('id', body.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ branch: data })
}

export async function DELETE(req: Request) {
  const scope = await getAccessScope()
  if (!scope.isSuperAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('branches').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
