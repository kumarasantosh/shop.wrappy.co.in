import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'

type SubscriptionBody = {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

// Store (upsert) an admin browser's Web Push subscription so the server can
// alert them to new orders even when no tab is open.
export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ ok: false }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as SubscriptionBody
  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 })
  }

  const userAgent = req.headers.get('user-agent') || null

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(
      {
        clerk_user_id: admin.userId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Remove a subscription (e.g. when the admin disables notifications).
export async function DELETE(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as SubscriptionBody
  if (!body.endpoint) return NextResponse.json({ error: 'missing_endpoint' }, { status: 400 })

  await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', body.endpoint)
  return NextResponse.json({ ok: true })
}
