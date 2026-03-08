'use client'
import React, { useEffect, useRef, useState } from 'react'

type OSMAddressPickerProps = {
  latitude: number | null
  longitude: number | null
  onLocationChange: (value: {
    latitude: number
    longitude: number
    addressLine?: string
    city?: string
    state?: string
    pincode?: string
    country?: string
  }) => void
}

type NominatimResponse = {
  display_name?: string
  address?: Record<string, string | undefined>
}

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 }

function extractCity(address: Record<string, string | undefined> | undefined) {
  if (!address) return ''
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.county ||
    ''
  )
}

export default function OSMAddressPicker({
  latitude,
  longitude,
  onLocationChange,
}: OSMAddressPickerProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const geocodeSeqRef = useRef(0)

  const [mapError, setMapError] = useState('')
  const [gettingCurrentLocation, setGettingCurrentLocation] = useState(false)
  const [geolocationError, setGeolocationError] = useState('')
  const [reverseGeocoding, setReverseGeocoding] = useState(false)

  function ensureMarker(lat: number, lng: number) {
    const L = leafletRef.current
    if (!L || !mapRef.current) return

    if (!markerRef.current) {
      const icon = L.divIcon({
        className: 'leaflet-pin',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })

      markerRef.current = L.marker([lat, lng], {
        draggable: true,
        icon,
      }).addTo(mapRef.current)

      markerRef.current.on('dragend', () => {
        const nextPos = markerRef.current.getLatLng()
        handleCoordinateChange(Number(nextPos.lat), Number(nextPos.lng))
      })
    } else {
      markerRef.current.setLatLng([lat, lng])
    }

    mapRef.current.setView([lat, lng], 16, { animate: true })
  }

  async function reverseGeocode(lat: number, lng: number) {
    const seq = ++geocodeSeqRef.current
    setReverseGeocoding(true)

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'en',
          },
        }
      )

      const payload = (await response.json()) as NominatimResponse
      if (seq !== geocodeSeqRef.current) return

      const fullAddress = String(payload.display_name || '').trim()
      const city = extractCity(payload.address)
      const state = String(payload.address?.state || payload.address?.region || '').trim()
      const pincode = String(payload.address?.postcode || '').trim()
      const country = String(payload.address?.country || '').trim()

      onLocationChange({
        latitude: lat,
        longitude: lng,
        addressLine: fullAddress || undefined,
        city: city || undefined,
        state: state || undefined,
        pincode: pincode || undefined,
        country: country || undefined,
      })
    } catch {
      if (seq !== geocodeSeqRef.current) return
      onLocationChange({ latitude: lat, longitude: lng })
    } finally {
      if (seq === geocodeSeqRef.current) {
        setReverseGeocoding(false)
      }
    }
  }

  function handleCoordinateChange(lat: number, lng: number) {
    ensureMarker(lat, lng)
    reverseGeocode(lat, lng).catch(() => {})
  }

  function requestCurrentLocation(userTriggered: boolean, applyToAddress = true) {
    if (!navigator.geolocation) {
      const message = 'Geolocation is not supported by this browser.'
      if (userTriggered) alert(message)
      if (userTriggered) {
        setGeolocationError(message)
      }
      return
    }

    setGettingCurrentLocation(true)
    if (userTriggered) {
      setGeolocationError('')
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude)
        const lng = Number(position.coords.longitude)
        if (applyToAddress) {
          handleCoordinateChange(lat, lng)
        } else if (mapRef.current) {
          mapRef.current.setView([lat, lng], 16, { animate: true })
        }
        setGettingCurrentLocation(false)
      },
      (error) => {
        let message = error.message || 'Unable to fetch current location.'
        if (error.code === error.PERMISSION_DENIED) {
          message = 'Location permission denied. Please allow location access.'
        }
        if (userTriggered) alert(message)
        if (userTriggered) {
          setGeolocationError(message)
        }
        setGettingCurrentLocation(false)
      },
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return

    let disposed = false

    import('leaflet')
      .then((module) => {
        if (disposed || !mapNodeRef.current) return
        const L = module.default
        leafletRef.current = L

        const startLat = latitude ?? INDIA_CENTER.lat
        const startLng = longitude ?? INDIA_CENTER.lng
        mapRef.current = L.map(mapNodeRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([startLat, startLng], latitude !== null && longitude !== null ? 16 : 5)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current)

        mapRef.current.on('click', (event: any) => {
          const lat = Number(event?.latlng?.lat)
          const lng = Number(event?.latlng?.lng)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
          handleCoordinateChange(lat, lng)
        })

        if (latitude !== null && longitude !== null) {
          ensureMarker(latitude, longitude)
        } else {
          requestCurrentLocation(false, false)
        }

        setMapError('')
      })
      .catch(() => {
        setMapError('Leaflet map failed to load. Please refresh and try again.')
      })

    return () => {
      disposed = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRef.current = null
    }
  }, [latitude, longitude])

  useEffect(() => {
    if (latitude === null || longitude === null) return
    ensureMarker(latitude, longitude)
  }, [latitude, longitude])

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => requestCurrentLocation(true)}
        disabled={gettingCurrentLocation}
        className="rounded-xl border border-white/10 bg-[#222] px-4 py-3 text-xs font-medium text-white disabled:opacity-60"
      >
        {gettingCurrentLocation ? 'Fetching Current Location...' : 'Use Current Location'}
      </button>

      {geolocationError ? <p className="text-xs text-red-300">{geolocationError}</p> : null}
      {mapError ? <p className="text-xs text-red-300">{mapError}</p> : null}
      {reverseGeocoding ? (
        <p className="text-xs text-gray-500">Updating address from selected location...</p>
      ) : null}

      <div
        ref={mapNodeRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-white/10 bg-[#111]"
      />

      <p className="text-xs text-gray-500">
        Tap map or drag marker to update location.
        {latitude !== null && longitude !== null
          ? ` (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
          : ''}
      </p>
    </div>
  )
}
