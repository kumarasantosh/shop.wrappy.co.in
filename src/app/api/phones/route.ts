import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

function hasSupabase() {
    return Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    )
}

export async function GET() {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (!hasSupabase()) return NextResponse.json({ phones: [] })

    const { data, error } = await supabaseAdmin
        .from('customer_phones')
        .select('*')
        .eq('customer_clerk_id', userId)
        .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ phones: data || [] })
}

export async function POST(req: Request) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (!hasSupabase()) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
    }

    const body = (await req.json()) as { phone?: string }
    const phone = String(body.phone || '').trim()
    if (!phone) {
        return NextResponse.json({ error: 'phone_required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('customer_phones')
        .upsert(
            { customer_clerk_id: userId, phone },
            { onConflict: 'customer_clerk_id,phone' }
        )
        .select('*')
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ phone: data })
}
