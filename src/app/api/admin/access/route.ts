import { NextResponse } from 'next/server'
import { getAccessScope } from '../../../../lib/admin'

export async function GET() {
  const scope = await getAccessScope()
  if (!scope.ok) {
    return NextResponse.json({ admin: false }, { status: 403 })
  }
  // Owners land on the full dashboard; branch admins/staff land on their
  // orders console (the only admin surface their role can see).
  const home = scope.isSuperAdmin ? '/admin' : '/admin/orders'
  return NextResponse.json({
    admin: true,
    role: scope.role,
    isSuperAdmin: scope.isSuperAdmin,
    home,
  })
}

