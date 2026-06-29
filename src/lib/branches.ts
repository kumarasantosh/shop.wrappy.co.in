export type BranchRole = 'admin' | 'staff'

export type BranchRecord = {
  id: string
  name: string
  slug: string
  address: string | null
  city: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  open_time: string
  close_time: string
  allow_preorder: boolean
  force_closed: boolean
  estimated_delivery_minutes: number
  is_active: boolean
  position: number
  created_at?: string
}

export type BranchMemberRecord = {
  id: string
  branch_id: string
  email: string
  role: BranchRole
  name: string | null
  is_active: boolean
  created_at?: string
}

export type BranchProductRecord = {
  id: string
  branch_id: string
  product_id: string
  is_available: boolean
  price_override: number | null
}

export type PublicBranch = {
  id: string
  name: string
  slug: string
  address: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
}

/** Haversine distance in kilometres between two lat/lng points. */
export function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Returns the nearest active branch that has coordinates set. */
export function nearestBranch<T extends { latitude: number | null; longitude: number | null }>(
  branches: T[],
  lat: number,
  lng: number
): T | null {
  let best: T | null = null
  let bestDist = Infinity
  for (const branch of branches) {
    if (branch.latitude == null || branch.longitude == null) continue
    const d = distanceKm(lat, lng, Number(branch.latitude), Number(branch.longitude))
    if (d < bestDist) {
      bestDist = d
      best = branch
    }
  }
  return best
}
