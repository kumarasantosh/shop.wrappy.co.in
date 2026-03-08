import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

type AddressBody = {
  id?: string
  label?: string
  address_line?: string
  apartment_name?: string
  flat_number?: string
  landmark?: string
  city?: string
  state?: string
  pincode?: string
  country?: string
  latitude?: number | string | null
  longitude?: number | string | null
  is_default?: boolean
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function normalizeRequiredText(value: unknown): string {
  return String(value ?? '').trim()
}

function parseCoordinate(
  value: unknown,
  min: number,
  max: number,
  name: string
): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || String(value).trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`invalid_${name}`)
  }
  return parsed
}

function hasSupabase() {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}

async function ensureDefaultAddress(customerClerkId: string) {
  const { data: currentDefault, error: defaultError } = await supabaseAdmin
    .from('addresses')
    .select('id')
    .eq('customer_clerk_id', customerClerkId)
    .eq('is_default', true)
    .limit(1)

  if (defaultError) return
  if (currentDefault && currentDefault.length > 0) return

  const { data: newestAddress } = await supabaseAdmin
    .from('addresses')
    .select('id')
    .eq('customer_clerk_id', customerClerkId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!newestAddress?.id) return

  await supabaseAdmin
    .from('addresses')
    .update({
      is_default: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', newestAddress.id)
    .eq('customer_clerk_id', customerClerkId)
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasSupabase()) return NextResponse.json({ addresses: [] })

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('customer_clerk_id', userId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ addresses: data || [] })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasSupabase()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

  const body = (await req.json()) as AddressBody
  const addressLine = normalizeRequiredText(body.address_line)
  if (!addressLine) {
    return NextResponse.json({ error: 'address_line_required' }, { status: 400 })
  }

  let latitude: number | null | undefined
  let longitude: number | null | undefined
  try {
    latitude = parseCoordinate(body.latitude, -90, 90, 'latitude')
    longitude = parseCoordinate(body.longitude, -180, 180, 'longitude')
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'invalid_coordinates' }, { status: 400 })
  }

  const { data: existingAddresses, error: existingError } = await supabaseAdmin
    .from('addresses')
    .select('id,is_default')
    .eq('customer_clerk_id', userId)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const shouldBeDefault = Boolean(body.is_default) || (existingAddresses || []).length === 0

  if (shouldBeDefault) {
    await supabaseAdmin
      .from('addresses')
      .update({
        is_default: false,
        updated_at: new Date().toISOString(),
      })
      .eq('customer_clerk_id', userId)
      .eq('is_default', true)
  }

  const payload = {
    customer_clerk_id: userId,
    label: normalizeOptionalText(body.label),
    address_line: addressLine,
    apartment_name: normalizeOptionalText(body.apartment_name),
    flat_number: normalizeOptionalText(body.flat_number),
    landmark: normalizeOptionalText(body.landmark),
    city: normalizeOptionalText(body.city),
    state: normalizeOptionalText(body.state),
    pincode: normalizeOptionalText(body.pincode),
    country: normalizeOptionalText(body.country),
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    is_default: shouldBeDefault,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .insert([payload])
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ address: data })
}

export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasSupabase()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

  const body = (await req.json()) as AddressBody
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const { data: existingAddress, error: existingError } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('id', body.id)
    .eq('customer_clerk_id', userId)
    .maybeSingle()

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (!existingAddress) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.label !== undefined) payload.label = normalizeOptionalText(body.label)

  if (body.address_line !== undefined) {
    const addressLine = normalizeRequiredText(body.address_line)
    if (!addressLine) {
      return NextResponse.json({ error: 'address_line_required' }, { status: 400 })
    }
    payload.address_line = addressLine
  }

  if (body.apartment_name !== undefined) {
    payload.apartment_name = normalizeOptionalText(body.apartment_name)
  }
  if (body.flat_number !== undefined) {
    payload.flat_number = normalizeOptionalText(body.flat_number)
  }
  if (body.landmark !== undefined) {
    payload.landmark = normalizeOptionalText(body.landmark)
  }
  if (body.city !== undefined) {
    payload.city = normalizeOptionalText(body.city)
  }
  if (body.state !== undefined) {
    payload.state = normalizeOptionalText(body.state)
  }
  if (body.pincode !== undefined) {
    payload.pincode = normalizeOptionalText(body.pincode)
  }
  if (body.country !== undefined) {
    payload.country = normalizeOptionalText(body.country)
  }

  try {
    if (body.latitude !== undefined) {
      payload.latitude = parseCoordinate(body.latitude, -90, 90, 'latitude')
    }
    if (body.longitude !== undefined) {
      payload.longitude = parseCoordinate(body.longitude, -180, 180, 'longitude')
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'invalid_coordinates' }, { status: 400 })
  }

  if (body.is_default !== undefined) {
    payload.is_default = Boolean(body.is_default)
    if (body.is_default) {
      await supabaseAdmin
        .from('addresses')
        .update({
          is_default: false,
          updated_at: new Date().toISOString(),
        })
        .eq('customer_clerk_id', userId)
        .neq('id', body.id)
        .eq('is_default', true)
    }
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update(payload)
    .eq('id', body.id)
    .eq('customer_clerk_id', userId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await ensureDefaultAddress(userId)
  return NextResponse.json({ address: data })
}

export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasSupabase()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const { data: existingAddress, error: existingError } = await supabaseAdmin
    .from('addresses')
    .select('id,is_default')
    .eq('id', id)
    .eq('customer_clerk_id', userId)
    .maybeSingle()

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (!existingAddress) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('addresses')
    .delete()
    .eq('id', id)
    .eq('customer_clerk_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existingAddress.is_default) {
    await ensureDefaultAddress(userId)
  }

  return NextResponse.json({ ok: true })
}
