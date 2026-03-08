import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/admin'

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ admin: false }, { status: 403 })
  }
  return NextResponse.json({ admin: true })
}

