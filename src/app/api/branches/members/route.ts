import { NextResponse } from 'next/server'
import { getAccessScope } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { BranchRole } from '../../../../lib/branches'

function hasSupabase() {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}

function canManageBranch(scope: Awaited<ReturnType<typeof getAccessScope>>, branchId: string) {
  if (scope.isSuperAdmin) return true
  return scope.isBranchAdmin && scope.branchIds.includes(branchId)
}

// List members for a branch (admins only).
export async function GET(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ members: [] })

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get('branchId') || ''

  let query = supabaseAdmin.from('branch_members').select('*').order('created_at', { ascending: true })
  if (branchId) {
    if (!canManageBranch(scope, branchId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    query = query.eq('branch_id', branchId)
  } else if (!scope.isSuperAdmin) {
    query = query.in('branch_id', scope.branchIds.length ? scope.branchIds : ['00000000-0000-0000-0000-000000000000'])
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data || [] })
}

export async function POST(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const body = (await req.json()) as {
    branch_id?: string
    email?: string
    role?: BranchRole
    name?: string
  }
  const branchId = String(body.branch_id || '')
  const email = String(body.email || '').trim().toLowerCase()
  const role: BranchRole = body.role === 'admin' ? 'admin' : 'staff'

  if (!branchId || !email) return NextResponse.json({ error: 'branch_and_email_required' }, { status: 400 })
  if (!canManageBranch(scope, branchId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('branch_members')
    .upsert(
      { branch_id: branchId, email, role, name: body.name || null, is_active: true },
      { onConflict: 'branch_id,email' }
    )
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}

export async function PATCH(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const body = (await req.json()) as {
    id?: string
    role?: BranchRole
    name?: string
    is_active?: boolean
  }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .from('branch_members')
    .select('branch_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!canManageBranch(scope, existing.branch_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const payload: Record<string, unknown> = {}
  if (body.role !== undefined) payload.role = body.role === 'admin' ? 'admin' : 'staff'
  if (body.name !== undefined) payload.name = body.name || null
  if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active)

  const { data, error } = await supabaseAdmin.from('branch_members').update(payload).eq('id', body.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}

export async function DELETE(req: Request) {
  const scope = await getAccessScope()
  if (!scope.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!hasSupabase()) return NextResponse.json({ error: 'supabase_required' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .from('branch_members')
    .select('branch_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ ok: true })
  if (!canManageBranch(scope, existing.branch_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin.from('branch_members').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
