import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const MOCK = [
  {
    id: 'c1',
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    min_order: 0,
    usage_limit: 100,
    used_count: 0,
    expires_at: null,
    is_active: true,
  },
]

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ coupons: MOCK })
  }

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupons: data || [] })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as {
    code?: string
    type?: string
    value?: number
    min_order?: number
    usage_limit?: number
    expires_at?: string | null
    is_active?: boolean
  }

  const code = String(body.code || '').trim().toUpperCase()
  const type = String(body.type || 'percent')
  const value = Number(body.value || 0)
  if (!code || value <= 0) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  const payload = {
    code,
    type,
    value,
    min_order: Number(body.min_order || 0),
    usage_limit: Number(body.usage_limit || 0),
    used_count: 0,
    expires_at: body.expires_at || null,
    is_active: body.is_active ?? true,
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ coupon: { ...payload, id: `mock_${Date.now()}` } })
  }

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert([payload])
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupon: data })
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as {
    id?: string
    code?: string
    type?: string
    value?: number
    min_order?: number
    usage_limit?: number
    expires_at?: string | null
    is_active?: boolean
  }

  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ coupon: { id: body.id, ...body } })
  }

  const payload: Record<string, unknown> = {}
  if (body.code !== undefined) {
    const code = String(body.code).trim().toUpperCase()
    if (!code) return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    payload.code = code
  }
  if (body.type !== undefined) {
    const type = String(body.type)
    if (!['percent', 'flat', 'first_order'].includes(type)) {
      return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
    }
    payload.type = type
  }
  if (body.value !== undefined) payload.value = Number(body.value)
  if (body.min_order !== undefined) payload.min_order = Number(body.min_order)
  if (body.usage_limit !== undefined) payload.usage_limit = Number(body.usage_limit)
  if (body.expires_at !== undefined) payload.expires_at = body.expires_at || null
  if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active)

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .update(payload)
    .eq('id', body.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupon: data })
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin.from('coupons').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
