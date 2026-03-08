import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function GET() {
    const admin = await requireAdmin()
    if (!admin.ok) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
        .from('admin_phones')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ phones: data || [] })
}

export async function POST(req: Request) {
    const admin = await requireAdmin()
    if (!admin.ok) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const phone = String(body.phone || '').trim()
    const label = String(body.label || '').trim() || null

    if (!phone) {
        return NextResponse.json({ error: 'phone_required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('admin_phones')
        .upsert(
            { phone, label, is_active: true },
            { onConflict: 'phone' }
        )
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ phone: data })
}

export async function DELETE(req: Request) {
    const admin = await requireAdmin()
    if (!admin.ok) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
        return NextResponse.json({ error: 'id_required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
        .from('admin_phones')
        .delete()
        .eq('id', id)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
