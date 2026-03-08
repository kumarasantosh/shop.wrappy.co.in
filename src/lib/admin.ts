import { auth, currentUser } from '@clerk/nextjs/server'

function parseAdminUserIds(): Set<string> {
  const raw = process.env.CLERK_ADMIN_USER_IDS || ''
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
}

const ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin'])

function metadataHasAdminFlag(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const value = metadata as Record<string, unknown>

  if (value.isAdmin === true || value.admin === true) return true

  const role = value.role
  if (typeof role === 'string' && ADMIN_ROLES.has(role.toLowerCase())) {
    return true
  }

  const roles = value.roles
  if (Array.isArray(roles)) {
    return roles.some(
      (entry) => typeof entry === 'string' && ADMIN_ROLES.has(entry.toLowerCase())
    )
  }

  return false
}

function sessionClaimsHasAdminFlag(sessionClaims: unknown): boolean {
  if (!sessionClaims || typeof sessionClaims !== 'object') return false
  const claims = sessionClaims as Record<string, unknown>

  return (
    metadataHasAdminFlag(claims) ||
    metadataHasAdminFlag(claims.public_metadata) ||
    metadataHasAdminFlag(claims.private_metadata) ||
    metadataHasAdminFlag(claims.unsafe_metadata) ||
    metadataHasAdminFlag(claims.metadata)
  )
}

export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return parseAdminUserIds().has(userId)
}

export async function hasAdminAccess({
  userId,
  sessionClaims,
}: {
  userId: string | null | undefined
  sessionClaims?: unknown
}) {
  if (!userId) return false
  if (isAdminUser(userId)) return true
  if (sessionClaimsHasAdminFlag(sessionClaims)) return true

  // Fallback to fresh Clerk profile metadata when session claims do not include metadata.
  const user = await currentUser().catch(() => null)
  if (!user) return false

  return (
    metadataHasAdminFlag(user.publicMetadata) ||
    metadataHasAdminFlag(user.privateMetadata) ||
    metadataHasAdminFlag(user.unsafeMetadata)
  )
}

export async function requireAdmin() {
  const session = await auth()
  const userId = session.userId
  const allowed = await hasAdminAccess({
    userId,
    sessionClaims: session.sessionClaims,
  })
  if (!allowed) {
    return { ok: false as const, userId }
  }
  return { ok: true as const, userId }
}

