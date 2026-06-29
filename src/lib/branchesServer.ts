import 'server-only'
import { supabaseAdmin } from './supabaseAdmin'
import {
  BranchMemberRecord,
  BranchProductRecord,
  BranchRecord,
} from './branches'

function hasSupabase(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}

/** Fetch a single branch by id (service role). */
export async function getBranchById(branchId: string): Promise<BranchRecord | null> {
  if (!hasSupabase() || !branchId) return null
  const { data } = await supabaseAdmin
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .maybeSingle()
  return (data as BranchRecord) || null
}

/** Fetch all active branches ordered by position. */
export async function listActiveBranches(): Promise<BranchRecord[]> {
  if (!hasSupabase()) return []
  const { data } = await supabaseAdmin
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('position', { ascending: true })
  return (data as BranchRecord[]) || []
}

/**
 * Branch memberships for a given email (case-insensitive).
 * Used to scope admin/staff access to their own branch.
 */
export async function getBranchMembershipsByEmail(
  email: string | null | undefined
): Promise<BranchMemberRecord[]> {
  if (!hasSupabase() || !email) return []
  const { data } = await supabaseAdmin
    .from('branch_members')
    .select('*')
    .eq('is_active', true)
    .ilike('email', email.trim())
  return (data as BranchMemberRecord[]) || []
}

/** Per-branch product overrides as a map keyed by product_id. */
export async function getBranchProductMap(
  branchId: string
): Promise<Map<string, BranchProductRecord>> {
  const map = new Map<string, BranchProductRecord>()
  if (!hasSupabase() || !branchId) return map
  const { data } = await supabaseAdmin
    .from('branch_products')
    .select('*')
    .eq('branch_id', branchId)
  for (const row of (data as BranchProductRecord[]) || []) {
    map.set(String(row.product_id), row)
  }
  return map
}
