import { NextResponse } from 'next/server'

/**
 * POST /api/delivery/quote
 * Body: { latitude, longitude, subtotal }
 * Returns: { fee: number, free?: boolean }
 *
 * Fee calculation uses these env vars (set in .env.local):
 *   STORE_LATITUDE          — Store lat (required for distance-based fee)
 *   STORE_LONGITUDE         — Store lng
 *   DELIVERY_BASE_FEE       — Flat base fee in ₹ (default: 40)
 *   DELIVERY_FEE_PER_KM     — Extra ₹ per km beyond 1 km (default: 10)
 *   FREE_DELIVERY_ABOVE     — Subtotal above which delivery is free, 0 = never free (default: 0)
 */

const STORE_LAT = Number(process.env.STORE_LATITUDE || '0')
const STORE_LNG = Number(process.env.STORE_LONGITUDE || '0')
const BASE_FEE = Number(process.env.DELIVERY_BASE_FEE || '40')
const FEE_PER_KM = Number(process.env.DELIVERY_FEE_PER_KM || '10')
const FREE_DELIVERY_ABOVE = Number(process.env.FREE_DELIVERY_ABOVE || '0')

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      latitude?: unknown
      longitude?: unknown
      subtotal?: unknown
    }

    const lat = Number(body.latitude)
    const lng = Number(body.longitude)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 })
    }

    const subtotal = Number(body.subtotal || 0)

    // Free delivery above threshold
    if (FREE_DELIVERY_ABOVE > 0 && subtotal >= FREE_DELIVERY_ABOVE) {
      return NextResponse.json({ fee: 0, free: true })
    }

    let fee = BASE_FEE

    if (STORE_LAT && STORE_LNG) {
      const distKm = haversineKm(STORE_LAT, STORE_LNG, lat, lng)
      // Base fee covers up to 1 km; add per-km charge beyond that
      const extraKm = Math.max(0, distKm - 1)
      fee = Math.round(BASE_FEE + extraKm * FEE_PER_KM)
    }

    return NextResponse.json({ fee: Math.max(0, fee) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
