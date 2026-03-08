import React from 'react'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import AdminShell from '../../components/admin/AdminShell'
import { hasAdminAccess } from '../../lib/admin'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const allowed = await hasAdminAccess({
    userId: session.userId,
    sessionClaims: session.sessionClaims,
  })

  if (!allowed) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-2xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-gray-500">
          This account is not authorized for store administration.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black"
        >
          Back to Home
        </Link>
      </div>
    )
  }

  return <AdminShell>{children}</AdminShell>
}
