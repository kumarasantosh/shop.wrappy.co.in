import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const MOCK_CATEGORIES = [
  { id: 'mock-all', name: 'All', position: 0 },
  { id: 'mock-starters', name: 'Starters', position: 1 },
  { id: 'mock-mains', name: 'Mains', position: 2 },
  { id: 'mock-desserts', name: 'Desserts', position: 3 },
  { id: 'mock-beverages', name: 'Beverages', position: 4 },
]

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ categories: MOCK_CATEGORIES })
  }

  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ categories: data || [] })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as { name?: string; position?: number }
  const name = String(body.name || '').trim()
  const position = Number(body.position || 0)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({
      category: { id: `mock_${Date.now()}`, name, position },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert([{ name, position }])
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ category: data })
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as { id?: string; name?: string; position?: number }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ category: { id: body.id, ...body } })
  }

  const payload: Record<string, unknown> = {}
  if (body.name !== undefined) payload.name = String(body.name).trim()
  if (body.position !== undefined) payload.position = Number(body.position)

  const { data, error } = await supabaseAdmin
    .from('categories')
    .update(payload)
    .eq('id', body.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ category: data })
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

  const { error } = await supabaseAdmin.from('categories').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
