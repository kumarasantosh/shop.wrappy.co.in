import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/admin'
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { sendAdminPush } from '../../../../../lib/webPush'

/**
 * Sends a test push to every stored admin subscription and reports exactly
 * what happened — so a missing VAPID key, an empty push_subscriptions table,
 * or dead subscriptions can be diagnosed from the admin panel in one click.
 */
export async function POST() {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const configured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  )

  const { count } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })

  const result = configured
    ? await sendAdminPush({
        title: '🔔 Test alert',
        body: 'Push notifications are working.',
        url: '/admin/orders',
        tag: 'wrappy-test',
      })
    : { sent: 0, failed: 0 }

  return NextResponse.json({
    ok: true,
    configured,
    subscriptions: count ?? 0,
    ...result,
  })
}
