import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const MOCK_PRODUCTS = [
  {
    id: 'm1',
    name: 'Truffle Risotto',
    description: 'Creamy arborio with black truffle',
    price: 499,
    is_veg: false,
    is_available: true,
    image_url:
      'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=1000&q=80',
    category_id: 'mock-main',
    category: { id: 'mock-main', name: 'Mains', position: 2 },
    addons: [{ id: 'm1-a1', name: 'Extra Parmesan', price: 60 }],
  },
  {
    id: 'm2',
    name: 'Garden Salad',
    description: 'Seasonal greens',
    price: 299,
    is_veg: true,
    is_available: true,
    image_url:
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1000&q=80',
    category_id: 'mock-starter',
    category: { id: 'mock-starter', name: 'Starters', position: 1 },
    addons: [{ id: 'm2-a1', name: 'Avocado', price: 80 }],
  },
]

type ProductBody = {
  name?: string
  description?: string
  price?: number
  is_veg?: boolean
  is_available?: boolean
  category_id?: string | null
  image_url?: string | null
  addons?: Array<{ id?: string; name: string; price: number }>
}

function normalizeAddons(
  addons: ProductBody['addons']
): Array<{ id: string; name: string; price: number }> {
  if (!Array.isArray(addons)) return []
  return addons
    .filter((addon) => addon?.name && Number(addon.price) >= 0)
    .map((addon, index) => ({
      id: addon.id || `addon_${Date.now()}_${index}`,
      name: String(addon.name).trim(),
      price: Number(addon.price),
    }))
}

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ products: MOCK_PRODUCTS })
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .select(
      'id,name,description,price,is_veg,is_available,image_url,category_id,addons,created_at,category:categories(id,name,position)'
    )
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data || [] })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as ProductBody
  const name = String(body.name || '').trim()
  const price = Number(body.price || 0)

  if (!name || price <= 0) {
    return NextResponse.json({ error: 'name_and_price_required' }, { status: 400 })
  }

  const payload = {
    name,
    description: body.description || null,
    price,
    is_veg: Boolean(body.is_veg),
    is_available: body.is_available !== false,
    category_id: body.category_id || null,
    image_url: body.image_url || null,
    addons: normalizeAddons(body.addons),
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ product: { ...payload, id: `mock_${Date.now()}` } })
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert([payload])
    .select(
      'id,name,description,price,is_veg,is_available,image_url,category_id,addons,created_at,category:categories(id,name,position)'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data })
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as ProductBody & { id?: string }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ product: { id: body.id, ...body } })
  }

  const updatePayload: Record<string, unknown> = {}
  if (body.name !== undefined) updatePayload.name = String(body.name).trim()
  if (body.description !== undefined) updatePayload.description = body.description || null
  if (body.price !== undefined) updatePayload.price = Number(body.price)
  if (body.is_veg !== undefined) updatePayload.is_veg = Boolean(body.is_veg)
  if (body.is_available !== undefined) {
    updatePayload.is_available = Boolean(body.is_available)
  }
  if (body.category_id !== undefined) updatePayload.category_id = body.category_id || null
  if (body.image_url !== undefined) updatePayload.image_url = body.image_url || null
  if (body.addons !== undefined) updatePayload.addons = normalizeAddons(body.addons)

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(updatePayload)
    .eq('id', body.id)
    .select(
      'id,name,description,price,is_veg,is_available,image_url,category_id,addons,created_at,category:categories(id,name,position)'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data })
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin.from('products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
