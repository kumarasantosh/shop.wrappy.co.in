import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { getDefaultStoreSettings, normalizeStoreSettings } from '../../../lib/storeStatus'
import { StoreSettingsRecord } from '../../../lib/types'

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(getDefaultStoreSettings())
  }

  const { data, error } = await supabaseAdmin
    .from('store_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(normalizeStoreSettings(data as Partial<StoreSettingsRecord>))
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as Partial<StoreSettingsRecord>
  const normalized = normalizeStoreSettings(body)

  const payload = {
    open_time: `${normalized.open_time}:00`,
    close_time: `${normalized.close_time}:00`,
    allow_preorder: normalized.allow_preorder,
    force_closed: normalized.force_closed,
    estimated_delivery_minutes: Number(normalized.estimated_delivery_minutes || 30),
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ settings: payload })
  }

  const { data: existing } = await supabaseAdmin
    .from('store_settings')
    .select('id')
    .limit(1)
    .maybeSingle()

  const upsertPayload = existing?.id ? { id: existing.id, ...payload } : payload

  const { data, error } = await supabaseAdmin
    .from('store_settings')
    .upsert(upsertPayload)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    settings: normalizeStoreSettings(data as Partial<StoreSettingsRecord>),
  })
}
