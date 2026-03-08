export const STORE_LOCATION = {
  latitude: 17.497761893885446,
  longitude: 78.394967441416,
} as const

export const MAX_DELIVERY_DISTANCE_KM = 10

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org'
const OSRM_BASE_URL = (process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL).replace(/\/+$/, '')

export type DeliveryDistanceMethod = 'driving' | 'haversine'

export type DeliveryRadiusCheck = {
  distanceKm: number
  withinRange: boolean
  method: DeliveryDistanceMethod
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

export function distanceInKm(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
) {
  const earthRadiusKm = 6371
  const dLat = toRadians(endLat - startLat)
  const dLng = toRadians(endLng - startLng)

  const lat1 = toRadians(startLat)
  const lat2 = toRadians(endLat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

export function isWithinDeliveryRadiusByAir(
  latitude: number,
  longitude: number,
  maxDistanceKm: number = MAX_DELIVERY_DISTANCE_KM
) : DeliveryRadiusCheck {
  const distance = distanceInKm(
    STORE_LOCATION.latitude,
    STORE_LOCATION.longitude,
    latitude,
    longitude
  )

  return {
    distanceKm: distance,
    withinRange: distance <= maxDistanceKm,
    method: 'haversine',
  }
}

async function distanceInKmByDrivingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<number | null> {
  try {
    const response = await fetch(
      `${OSRM_BASE_URL}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=false&alternatives=false&steps=false`,
      {
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    )

    if (!response.ok) return null

    const payload = (await response.json()) as {
      code?: string
      routes?: Array<{ distance?: number }>
    }
    if (payload.code !== 'Ok') return null

    const distanceMeters = Number(payload.routes?.[0]?.distance)
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null

    return distanceMeters / 1000
  } catch {
    return null
  }
}

export async function isWithinDeliveryRadius(
  latitude: number,
  longitude: number,
  maxDistanceKm: number = MAX_DELIVERY_DISTANCE_KM
): Promise<DeliveryRadiusCheck> {
  const drivingDistance = await distanceInKmByDrivingRoute(
    STORE_LOCATION.latitude,
    STORE_LOCATION.longitude,
    latitude,
    longitude
  )

  if (drivingDistance !== null) {
    return {
      distanceKm: drivingDistance,
      withinRange: drivingDistance <= maxDistanceKm,
      method: 'driving',
    }
  }

  return isWithinDeliveryRadiusByAir(latitude, longitude, maxDistanceKm)
}
