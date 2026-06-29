import { auth, currentUser } from '@clerk/nextjs/server'
import { BranchRole } from './branches'
import { getBranchMembershipsByEmail } from './branchesServer'

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

// ── Branch-scoped access ─────────────────────────────────────────────────────

/** Best-effort primary email of the current Clerk user. */
export async function getCurrentUserEmail(): Promise<string | null> {
  const user = await currentUser().catch(() => null)
  if (!user) return null
  const primaryId = user.primaryEmailAddressId
  const primary = user.emailAddresses?.find((e) => e.id === primaryId)
  return (primary?.emailAddress || user.emailAddresses?.[0]?.emailAddress || null) || null
}

export type AccessScope = {
  ok: boolean
  userId: string | null
  email: string | null
  /** Global owner/superadmin — sees and manages every branch. */
  isSuperAdmin: boolean
  /** Highest role across the user's branch memberships. */
  role: 'super' | BranchRole | null
  /** Branch ids the user may act on. Empty + isSuperAdmin means "all". */
  branchIds: string[]
  /** True if the user is a branch admin in at least one branch. */
  isBranchAdmin: boolean
}

/**
 * Resolves what the current user is allowed to do: global superadmin, a
 * per-branch admin, or per-branch staff. Used by admin pages/routes to scope
 * data to the caller's branch.
 */
export async function getAccessScope(): Promise<AccessScope> {
  const session = await auth()
  const userId = session.userId
  if (!userId) {
    return { ok: false, userId: null, email: null, isSuperAdmin: false, role: null, branchIds: [], isBranchAdmin: false }
  }

  const superAdmin = await hasAdminAccess({
    userId,
    sessionClaims: session.sessionClaims,
  })

  const email = await getCurrentUserEmail()
  const memberships = await getBranchMembershipsByEmail(email)
  const branchIds = Array.from(new Set(memberships.map((m) => m.branch_id)))
  const isBranchAdmin = memberships.some((m) => m.role === 'admin')

  if (superAdmin) {
    return { ok: true, userId, email, isSuperAdmin: true, role: 'super', branchIds, isBranchAdmin: true }
  }

  if (memberships.length > 0) {
    return {
      ok: true,
      userId,
      email,
      isSuperAdmin: false,
      role: isBranchAdmin ? 'admin' : 'staff',
      branchIds,
      isBranchAdmin,
    }
  }

  return { ok: false, userId, email, isSuperAdmin: false, role: null, branchIds, isBranchAdmin: false }
}

/**
 * Like requireAdmin but also grants access to branch admins/staff.
 * Returns the resolved scope so callers can filter by branch.
 */
export async function requireBranchAccess(): Promise<AccessScope> {
  return getAccessScope()
}

