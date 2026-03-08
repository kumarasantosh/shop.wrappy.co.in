'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import OSMAddressPicker from '../../components/OSMAddressPicker'
import { useCartStore } from '../../store/cart'
import { AddressRecord, CustomerPhoneRecord } from '../../lib/types'
import { isWithinDeliveryRadius, MAX_DELIVERY_DISTANCE_KM } from '../../lib/deliveryRadius'

const TAX_RATE = 0.05
const PACKING_FEE_PER_ITEM = 5
const GUEST_ADDRESSES_KEY = 'wrappy_guest_addresses_v1'

declare global {
  interface Window {
    Razorpay: any
  }
}

type AddressFormState = {
  label: string
  address_line: string
  apartment_name: string
  flat_number: string
  landmark: string
  city: string
  state: string
  pincode: string
  country: string
  latitude: number | null
  longitude: number | null
  is_default: boolean
}

type NominatimSearchResult = {
  lat?: string
  lon?: string
  display_name?: string
  address?: Record<string, string | undefined>
}

type OrderType = 'delivery' | 'pickup'

function toLocalDatetimeString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

function loadRazorpayScript() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) {
      resolve(true)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

function emptyAddressForm(defaultValue = false): AddressFormState {
  return {
    label: '',
    address_line: '',
    apartment_name: '',
    flat_number: '',
    landmark: '',
    city: '',
    state: '',
    pincode: '',
    country: '',
    latitude: null,
    longitude: null,
    is_default: defaultValue,
  }
}

function parseGuestAddresses(raw: string | null): AddressRecord[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as AddressRecord[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function sortAddresses(addresses: AddressRecord[]): AddressRecord[] {
  return [...addresses].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

function ensureSingleDefault(addresses: AddressRecord[]): AddressRecord[] {
  if (addresses.length === 0) return []
  const hasDefault = addresses.some((address) => address.is_default)
  if (hasDefault) return addresses
  return addresses.map((address, index) =>
    index === 0 ? { ...address, is_default: true } : address
  )
}

function formatAddressForDisplay(address: AddressRecord) {
  const parts = [
    address.flat_number && `Flat ${address.flat_number}`,
    address.apartment_name,
    address.address_line,
    [address.city, address.state].filter(Boolean).join(', '),
    address.pincode && `PIN: ${address.pincode}`,
    address.country,
    address.landmark && `Landmark: ${address.landmark}`,
  ].filter(Boolean)

  return parts.join(', ')
}

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

function buildAddressQuery(value: {
  address_line?: string | null
  apartment_name?: string | null
  flat_number?: string | null
  landmark?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  country?: string | null
}) {
  return [
    value.flat_number,
    value.apartment_name,
    value.address_line,
    value.landmark,
    value.city,
    value.state,
    value.pincode,
    value.country,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
}

async function geocodeAddressQuery(query: string): Promise<{
  latitude: number
  longitude: number
  addressLine?: string
  city?: string
  state?: string
  pincode?: string
  country?: string
} | null> {
  const cleanQuery = query.trim()
  if (!cleanQuery) return null

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        cleanQuery
      )}&format=json&limit=1&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
        },
      }
    )
    const payload = (await response.json()) as NominatimSearchResult[]
    const first = Array.isArray(payload) ? payload[0] : undefined
    const lat = Number(first?.lat)
    const lng = Number(first?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    const city = extractCity(first?.address)
    const state = String(first?.address?.state || first?.address?.region || '').trim()
    const pincode = String(first?.address?.postcode || '').trim()
    const country = String(first?.address?.country || '').trim()

    return {
      latitude: lat,
      longitude: lng,
      addressLine: String(first?.display_name || '').trim() || undefined,
      city: city || undefined,
      state: state || undefined,
      pincode: pincode || undefined,
      country: country || undefined,
    }
  } catch {
    return null
  }
}

export default function CheckoutPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const items = useCartStore((state) => state.items)
  const clearCart = useCartStore((state) => state.clear)
  const storedCouponCode = useCartStore((state) => state.couponCode)

  const [addresses, setAddresses] = useState<AddressRecord[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [addressForm, setAddressForm] = useState<AddressFormState>(emptyAddressForm())
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [addressesLoading, setAddressesLoading] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null)

  const [orderType, setOrderType] = useState<OrderType>('pickup')
  const [pickupSlot, setPickupSlot] = useState('')
  const [pickupCode, setPickupCode] = useState('')
  const [includePickupPacking, setIncludePickupPacking] = useState(true)
  const [phone, setPhone] = useState('')
  const [savedPhones, setSavedPhones] = useState<CustomerPhoneRecord[]>([])
  const [phonesLoading, setPhonesLoading] = useState(false)
  const [useCustomPhone, setUseCustomPhone] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [couponCode, setCouponCode] = useState(storedCouponCode || '')
  const [discountAmount, setDiscountAmount] = useState(0)
  const [discountLabel, setDiscountLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolvedDistanceCheck, setResolvedDistanceCheck] = useState<{
    addressId: string
    distanceKm: number
    withinRange: boolean
    method?: 'driving' | 'haversine'
    latitude: number
    longitude: number
  } | null>(null)
  const [resolvingDistance, setResolvingDistance] = useState(false)

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  )
  const totalItemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.qty, 0),
    [items]
  )
  const taxableAmount = Math.max(0, subtotal - discountAmount)
  const tax = Math.round(taxableAmount * TAX_RATE)
  const shouldChargePacking = orderType === 'delivery' || includePickupPacking
  const packingFee = shouldChargePacking ? totalItemCount * PACKING_FEE_PER_ITEM : 0
  const deliveryFee = 0
  const total = taxableAmount + tax + packingFee + deliveryFee
  const [pickupMinDatetime, setPickupMinDatetime] = useState(() =>
    toLocalDatetimeString(new Date(Date.now() + 30 * 60_000))
  )
  useEffect(() => {
    const tick = () => {
      const minDate = new Date(Date.now() + 30 * 60_000)
      setPickupMinDatetime(toLocalDatetimeString(minDate))
      // Auto-clear stale selection
      setPickupSlot((current) => {
        if (current && new Date(current).getTime() < minDate.getTime()) return ''
        return current
      })
    }
    const interval = setInterval(tick, 30_000)
    tick() // run immediately on mount/re-render
    return () => clearInterval(interval)
  }, [])

  const selectedAddress = useMemo(
    () => addresses.find((address) => address.id === selectedAddressId) || null,
    [addresses, selectedAddressId]
  )

  const deliveryDistanceCheck = useMemo(() => {
    if (!selectedAddress) return null
    if (resolvedDistanceCheck && resolvedDistanceCheck.addressId === selectedAddress.id) {
      return resolvedDistanceCheck
    }
    return null
  }, [selectedAddress, resolvedDistanceCheck])

  const effectiveCoordinates = useMemo(() => {
    if (!selectedAddress) return null

    if (resolvedDistanceCheck && resolvedDistanceCheck.addressId === selectedAddress.id) {
      return {
        latitude: resolvedDistanceCheck.latitude,
        longitude: resolvedDistanceCheck.longitude,
      }
    }
    return null
  }, [selectedAddress, resolvedDistanceCheck])

  const isOutsideDeliveryRange = Boolean(
    deliveryDistanceCheck && !deliveryDistanceCheck.withinRange
  )
  const isDeliveryDistancePending = Boolean(
    orderType === 'delivery' && selectedAddress && resolvingDistance
  )



  useEffect(() => {
    if (orderType === 'delivery') {
      setPickupCode('')
    }
  }, [orderType])

  useEffect(() => {
    let cancelled = false

    async function resolveSelectedAddressDistance() {
      if (orderType !== 'delivery') {
        setResolvedDistanceCheck(null)
        setResolvingDistance(false)
        return
      }

      if (!selectedAddress) {
        setResolvedDistanceCheck(null)
        setResolvingDistance(false)
        return
      }

      setResolvingDistance(true)

      const hasValidStoredCoordinates =
        selectedAddress.latitude !== null &&
        selectedAddress.longitude !== null &&
        Number.isFinite(Number(selectedAddress.latitude)) &&
        Number.isFinite(Number(selectedAddress.longitude))

      let targetLocation: {
        latitude: number
        longitude: number
        city?: string
        state?: string
        pincode?: string
        country?: string
      } | null = hasValidStoredCoordinates
          ? {
            latitude: Number(selectedAddress.latitude),
            longitude: Number(selectedAddress.longitude),
          }
          : null

      const query = buildAddressQuery(selectedAddress)
      if (query) {
        const geocoded = await geocodeAddressQuery(query)
        if (cancelled) return

        if (geocoded) {
          targetLocation = geocoded
        }
      }

      if (!targetLocation) {
        setResolvedDistanceCheck(null)
        setResolvingDistance(false)
        return
      }

      const nextCheck = await isWithinDeliveryRadius(
        targetLocation.latitude,
        targetLocation.longitude,
        MAX_DELIVERY_DISTANCE_KM
      )
      if (cancelled) return

      setResolvedDistanceCheck({
        addressId: selectedAddress.id,
        distanceKm: nextCheck.distanceKm,
        withinRange: nextCheck.withinRange,
        method: nextCheck.method,
        latitude: targetLocation.latitude,
        longitude: targetLocation.longitude,
      })
      setResolvingDistance(false)

      if (hasValidStoredCoordinates) {
        return
      }

      setAddresses((previous) => {
        const next = previous.map((address) => {
          if (address.id !== selectedAddress.id) return address

          return {
            ...address,
            latitude: targetLocation?.latitude || address.latitude,
            longitude: targetLocation?.longitude || address.longitude,
            city: address.city || targetLocation?.city || null,
            state: address.state || targetLocation?.state || null,
            pincode: address.pincode || targetLocation?.pincode || null,
            country: address.country || targetLocation?.country || null,
            updated_at: new Date().toISOString(),
          }
        })

        if (!user?.id) {
          persistGuestAddresses(next)
        }
        return next
      })

      if (user?.id) {
        fetch('/api/addresses', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedAddress.id,
            latitude: targetLocation.latitude,
            longitude: targetLocation.longitude,
            city: selectedAddress.city || targetLocation.city || null,
            state: selectedAddress.state || targetLocation.state || null,
            pincode: selectedAddress.pincode || targetLocation.pincode || null,
            country: selectedAddress.country || targetLocation.country || null,
          }),
        }).catch(() => { })
      }
    }

    resolveSelectedAddressDistance().catch(() => {
      if (!cancelled) {
        setResolvingDistance(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [selectedAddress, user?.id, orderType])

  async function loadAddresses() {
    if (!isLoaded) return

    setAddressesLoading(true)
    try {
      if (!user?.id) {
        const guestAddresses = ensureSingleDefault(
          sortAddresses(
            parseGuestAddresses(
              typeof window !== 'undefined'
                ? localStorage.getItem(GUEST_ADDRESSES_KEY)
                : null
            )
          )
        )
        setAddresses(guestAddresses)
        setSelectedAddressId((current) => {
          if (current && guestAddresses.some((address) => address.id === current)) {
            return current
          }
          return guestAddresses.find((address) => address.is_default)?.id || guestAddresses[0]?.id || ''
        })
        setShowAddressForm(guestAddresses.length === 0)
        if (guestAddresses.length === 0) {
          setAddressForm(emptyAddressForm(true))
        }
        return
      }

      const response = await fetch('/api/addresses')
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to load addresses')
      }

      const rows = ensureSingleDefault(
        sortAddresses((payload.addresses || []) as AddressRecord[])
      )
      setAddresses(rows)
      setSelectedAddressId((current) => {
        if (current && rows.some((address) => address.id === current)) return current
        return rows.find((address) => address.is_default)?.id || rows[0]?.id || ''
      })
      setShowAddressForm(rows.length === 0)
      if (rows.length === 0) {
        setAddressForm(emptyAddressForm(true))
      }
    } catch (error) {
      console.error(error)
    } finally {
      setAddressesLoading(false)
    }
  }

  useEffect(() => {
    loadAddresses().catch(() => { })
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (!isLoaded || !user?.id) {
      setSavedPhones([])
      return
    }

    let cancelled = false
    async function loadPhones() {
      setPhonesLoading(true)
      try {
        const response = await fetch('/api/phones')
        const payload = await response.json()
        if (cancelled) return
        const phones = (payload.phones || []) as CustomerPhoneRecord[]
        setSavedPhones(phones)
        if (phones.length > 0 && !phone) {
          setPhone(phones[0].phone)
          setUseCustomPhone(false)
        }
      } catch {
        if (!cancelled) setSavedPhones([])
      } finally {
        if (!cancelled) setPhonesLoading(false)
      }
    }

    loadPhones()
    return () => { cancelled = true }
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (!subtotal) return

    let cancelled = false
    async function computeBestDiscount() {
      try {
        const response = await fetch('/api/discounts/best', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subtotal,
            customerClerkId: user?.id,
          }),
        })
        const payload = await response.json()
        if (cancelled) return

        if (payload.best?.coupon) {
          const bestCode = String(payload.best.coupon.code || '')
          const bestDiscount = Number(payload.best.discount || 0)
          setDiscountAmount(bestDiscount)
          setDiscountLabel(bestCode ? `Applied ${bestCode}` : '')
          if (!couponCode) {
            setCouponCode(bestCode)
          }
        } else {
          setDiscountAmount(0)
          setDiscountLabel('')
        }
      } catch {
        if (!cancelled) {
          setDiscountAmount(0)
          setDiscountLabel('')
        }
      }
    }

    computeBestDiscount()
    return () => {
      cancelled = true
    }
  }, [subtotal, user?.id, couponCode])

  function startAddAddress() {
    setEditingAddressId(null)
    setAddressForm(emptyAddressForm(addresses.length === 0))
    setShowAddressForm(true)
  }

  function startEditAddress(address: AddressRecord) {
    setEditingAddressId(address.id)
    setAddressForm({
      label: address.label || '',
      address_line: address.address_line,
      apartment_name: address.apartment_name || '',
      flat_number: address.flat_number || '',
      landmark: address.landmark || '',
      city: address.city || '',
      state: address.state || '',
      pincode: address.pincode || '',
      country: address.country || '',
      latitude: address.latitude,
      longitude: address.longitude,
      is_default: address.is_default,
    })
    setShowAddressForm(true)
  }

  function cancelAddressForm() {
    setShowAddressForm(false)
    setEditingAddressId(null)
    setAddressForm(emptyAddressForm(false))
  }

  function persistGuestAddresses(rows: AddressRecord[]) {
    if (typeof window === 'undefined') return
    localStorage.setItem(GUEST_ADDRESSES_KEY, JSON.stringify(rows))
  }

  async function saveAddress(event: React.FormEvent) {
    event.preventDefault()
    if (!addressForm.address_line.trim()) {
      alert('Address line is required.')
      return
    }

    let payloadForm = { ...addressForm }
    const missingCoordinates =
      payloadForm.latitude === null ||
      payloadForm.longitude === null ||
      !Number.isFinite(Number(payloadForm.latitude)) ||
      !Number.isFinite(Number(payloadForm.longitude))

    if (missingCoordinates) {
      const query = buildAddressQuery(payloadForm)
      const geocoded = await geocodeAddressQuery(query)
      if (geocoded) {
        payloadForm = {
          ...payloadForm,
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
          address_line: payloadForm.address_line || geocoded.addressLine || '',
          city: payloadForm.city || geocoded.city || '',
          state: payloadForm.state || geocoded.state || '',
          pincode: payloadForm.pincode || geocoded.pincode || '',
          country: payloadForm.country || geocoded.country || '',
        }
        setAddressForm(payloadForm)
      }
    }

    if (
      payloadForm.latitude === null ||
      payloadForm.longitude === null ||
      !Number.isFinite(Number(payloadForm.latitude)) ||
      !Number.isFinite(Number(payloadForm.longitude))
    ) {
      alert('Please pin location on map or use Current Location to verify delivery distance.')
      return
    }

    setSavingAddress(true)
    try {
      if (!user?.id) {
        const now = new Date().toISOString()
        const nextAddress: AddressRecord = {
          id:
            editingAddressId ||
            `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          customer_clerk_id: 'guest',
          label: payloadForm.label.trim() || null,
          address_line: payloadForm.address_line.trim(),
          apartment_name: payloadForm.apartment_name.trim() || null,
          flat_number: payloadForm.flat_number.trim() || null,
          landmark: payloadForm.landmark.trim() || null,
          city: payloadForm.city.trim() || null,
          state: payloadForm.state.trim() || null,
          pincode: payloadForm.pincode.trim() || null,
          country: payloadForm.country.trim() || null,
          latitude: Number(payloadForm.latitude),
          longitude: Number(payloadForm.longitude),
          is_default: Boolean(payloadForm.is_default),
          created_at: now,
          updated_at: now,
        }

        let nextRows = addresses.filter((address) => address.id !== nextAddress.id)
        if (nextAddress.is_default || nextRows.length === 0) {
          nextRows = nextRows.map((address) => ({ ...address, is_default: false }))
          nextAddress.is_default = true
        }
        nextRows = sortAddresses([nextAddress, ...nextRows])
        nextRows = ensureSingleDefault(nextRows)
        persistGuestAddresses(nextRows)
        setAddresses(nextRows)
        setSelectedAddressId(nextAddress.id)
        cancelAddressForm()
        return
      }

      const response = await fetch('/api/addresses', {
        method: editingAddressId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingAddressId || undefined,
          label: payloadForm.label || null,
          address_line: payloadForm.address_line,
          apartment_name: payloadForm.apartment_name || null,
          flat_number: payloadForm.flat_number || null,
          landmark: payloadForm.landmark || null,
          city: payloadForm.city || null,
          state: payloadForm.state || null,
          pincode: payloadForm.pincode || null,
          country: payloadForm.country || null,
          latitude: Number(payloadForm.latitude),
          longitude: Number(payloadForm.longitude),
          is_default: payloadForm.is_default,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        alert(payload?.error || 'Unable to save address')
        return
      }

      const savedId = payload.address?.id
      await loadAddresses()
      if (savedId) {
        setSelectedAddressId(savedId)
      }
      cancelAddressForm()
    } finally {
      setSavingAddress(false)
    }
  }

  async function setAddressAsDefault(addressId: string) {
    if (!addressId) return

    if (!user?.id) {
      let nextRows = addresses.map((address) => ({
        ...address,
        is_default: address.id === addressId,
        updated_at: new Date().toISOString(),
      }))
      nextRows = sortAddresses(nextRows)
      persistGuestAddresses(nextRows)
      setAddresses(nextRows)
      setSelectedAddressId(addressId)
      return
    }

    const response = await fetch('/api/addresses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: addressId, is_default: true }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      alert(payload?.error || 'Unable to set default address')
      return
    }
    await loadAddresses()
    setSelectedAddressId(addressId)
  }

  async function deleteAddress(addressId: string) {
    const confirmed = window.confirm('Delete this address?')
    if (!confirmed) return

    setDeletingAddressId(addressId)
    try {
      if (!user?.id) {
        let nextRows = addresses.filter((address) => address.id !== addressId)
        nextRows = ensureSingleDefault(sortAddresses(nextRows))
        persistGuestAddresses(nextRows)
        setAddresses(nextRows)
        setSelectedAddressId(
          nextRows.find((address) => address.is_default)?.id || nextRows[0]?.id || ''
        )
        if (editingAddressId === addressId) {
          cancelAddressForm()
        }
        return
      }

      const response = await fetch(`/api/addresses?id=${addressId}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || 'Unable to delete address')
        return
      }

      await loadAddresses()
      if (editingAddressId === addressId) {
        cancelAddressForm()
      }
    } finally {
      setDeletingAddressId(null)
    }
  }

  async function handlePlaceOrder() {
    if (!phone.trim()) {
      alert('Phone number is required.')
      return
    }

    const isPickup = orderType === 'pickup'
    let finalAddress = 'Self Pickup at Store'
    let latitude: number | undefined
    let longitude: number | undefined

    if (isPickup) {
      if (!pickupSlot) {
        alert('Please select a pickup date & time.')
        return
      }
      const pickupDate = new Date(pickupSlot)
      if (pickupDate.getTime() < Date.now() + 30 * 60_000) {
        alert('Pickup time must be at least 30 minutes from now.')
        return
      }
    } else {
      const selected = selectedAddress
      if (!selected) {
        alert('Please add and select a delivery address.')
        return
      }

      finalAddress = formatAddressForDisplay(selected)
      if (!finalAddress) {
        alert('Please provide a valid delivery address.')
        return
      }

      if (isDeliveryDistancePending) {
        alert('Validating distance for this address. Please try again in a moment.')
        return
      }

      if (!effectiveCoordinates) {
        alert('Please edit this address and set location on map to verify delivery distance.')
        return
      }

      if (isOutsideDeliveryRange) {
        const distance = deliveryDistanceCheck?.distanceKm?.toFixed(2)
        alert(
          `You are more than ${MAX_DELIVERY_DISTANCE_KM} km away (${distance} km). We recommend visiting the store.`
        )
        return
      }

      latitude = Number(effectiveCoordinates.latitude)
      longitude = Number(effectiveCoordinates.longitude)
    }

    setLoading(true)
    setPickupCode('')
    let paymentFlowStarted = false
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            qty: item.qty,
            price: item.price,
            addons: item.addons || [],
          })),
          address: finalAddress,
          phone: phone.trim() || undefined,
          instructions,
          couponCode: couponCode || undefined,
          orderType,
          pickupSlot: isPickup ? pickupSlot : undefined,
          includePacking: isPickup ? includePickupPacking : true,
          latitude,
          longitude,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        if (payload?.error === 'outside_delivery_radius') {
          const distance = Number(payload?.distance_km || 0).toFixed(2)
          alert(
            `You are more than ${MAX_DELIVERY_DISTANCE_KM} km away (${distance} km). We recommend visiting the store.`
          )
          return
        }
        if (payload?.error === 'product_unavailable') {
          const names = Array.isArray(payload?.items)
            ? payload.items.filter(Boolean).join(', ')
            : 'Some items'
          alert(`${names} currently not available. Please update your cart.`)
          return
        }
        const reason = payload.reason ? ` (${payload.reason})` : ''
        alert(`Unable to place order${reason}`)
        return
      }

      if (!payload.rzpOrder || !payload.key_id || !payload.draftToken) {
        alert('Unable to start Razorpay payment. Please try again.')
        return
      }

      const loaded = await loadRazorpayScript()
      if (!loaded) {
        alert('Payment SDK could not load. Try again.')
        return
      }

      const options = {
        key: payload.key_id,
        amount: payload.rzpOrder.amount,
        currency: payload.rzpOrder.currency,
        order_id: payload.rzpOrder.id,
        name: 'Wrappy',
        description: 'Restaurant Order',
        prefill: {
          name: user?.fullName || '',
          email: user?.primaryEmailAddress?.emailAddress || '',
          contact: phone,
        },
        theme: { color: '#0F0F0F' },
        handler: async (paymentResponse: any) => {
          try {
            const confirmResponse = await fetch('/api/orders/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                draftToken: payload.draftToken,
                razorpay_order_id: paymentResponse?.razorpay_order_id,
                razorpay_payment_id: paymentResponse?.razorpay_payment_id,
                razorpay_signature: paymentResponse?.razorpay_signature,
              }),
            })

            const confirmPayload = await confirmResponse.json()
            if (!confirmResponse.ok) {
              alert(confirmPayload?.error || 'Payment succeeded but order confirmation failed.')
              return
            }

            const nextPickupCode = String(confirmPayload?.pickupCode || '').trim()
            const nextPickupSlot = String(confirmPayload?.pickupSlot || '').trim()
            if (orderType === 'pickup' && nextPickupCode) {
              setPickupCode(nextPickupCode)
              const slotLabel = nextPickupSlot
                ? new Date(nextPickupSlot).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                : null
              alert(
                `Pickup confirmed. Your verification code is ${nextPickupCode}${slotLabel ? ` for ${slotLabel}` : ''}. Show this code at store to collect your order.`
              )
            }

            clearCart()
            router.push('/orders')
          } finally {
            setLoading(false)
          }
        },
        modal: {
          ondismiss: () => {
            setLoading(false)
          },
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', () => {
        setLoading(false)
      })
      paymentFlowStarted = true
      rzp.open()
    } catch (error) {
      console.error(error)
      alert('Order could not be placed. Please try again.')
    } finally {
      if (!paymentFlowStarted) {
        setLoading(false)
      }
    }
  }

  const placeOrderDisabled =
    loading ||
    (orderType === 'delivery'
      ? !selectedAddress || isOutsideDeliveryRange || isDeliveryDistancePending
      : !pickupSlot)

  if (!items.length) {
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-5xl">🛒</p>
        <h2 className="mb-2 text-xl font-semibold">Nothing to checkout</h2>
        <Link href="/menu" className="text-gray-400 transition-colors hover:text-white">
          Go to Menu →
        </Link>
      </div>
    )
  }

  return (
    <div className="py-6">
      <h1 className="mb-6 text-2xl font-bold">Checkout</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl border border-white/10 bg-[#181818] p-6">
          <div>
            <label className="mb-2 block text-sm text-gray-500">Order Type</label>
            <div className="grid grid-cols-2 gap-3">
              <div
                className="relative overflow-hidden rounded-xl border border-white/10 bg-[#222] px-4 py-4 opacity-50 cursor-not-allowed"
              >
                <div className="absolute -right-7 top-2 rotate-45 bg-gray-600 px-8 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-300">
                  Soon
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-2xl grayscale">🚚</span>
                  <span className="text-sm font-medium text-gray-500">Delivery</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderType('pickup')}
                className={`rounded-xl border px-4 py-4 transition-all ${orderType === 'pickup'
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                  : 'border-white/10 bg-[#222]'
                  }`}
              >
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-2xl">📦</span>
                  <span className={`text-sm font-medium ${orderType === 'pickup' ? 'text-emerald-300' : 'text-white'}`}>Self Pickup</span>
                </div>
              </button>
            </div>
          </div>

          {orderType === 'delivery' ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Delivery Addresses</h2>
                {!showAddressForm && (
                  <button
                    type="button"
                    onClick={startAddAddress}
                    className="rounded-lg border border-white/10 bg-[#222] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    + Add Address
                  </button>
                )}
              </div>

              {addressesLoading ? (
                <div className="text-sm text-gray-500">Loading addresses...</div>
              ) : addresses.length === 0 && !showAddressForm ? (
                <div className="rounded-xl border border-white/10 bg-[#222] p-4 text-sm text-gray-400">
                  No saved addresses found.
                  <button
                    type="button"
                    onClick={startAddAddress}
                    className="ml-2 font-medium text-white underline underline-offset-2"
                  >
                    Add one now
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map((address) => (
                    <div
                      key={address.id}
                      className={`rounded-xl border p-4 ${selectedAddressId === address.id
                        ? 'border-white/30 bg-[#1f1f1f]'
                        : 'border-white/10 bg-[#222]'
                        }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedAddressId(address.id)}
                            className={`h-4 w-4 rounded-full border ${selectedAddressId === address.id
                              ? 'border-white bg-white'
                              : 'border-gray-500 bg-transparent'
                              }`}
                          />
                          <p className="text-sm font-semibold text-white">
                            {address.label || 'Saved Address'}
                          </p>
                          {address.is_default && (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-300">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!address.is_default && (
                            <button
                              type="button"
                              onClick={() => setAddressAsDefault(address.id)}
                              className="rounded-lg border border-white/10 bg-[#181818] px-2.5 py-1 text-[11px] text-white"
                            >
                              Set Default
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEditAddress(address)}
                            className="rounded-lg border border-white/10 bg-[#181818] px-2.5 py-1 text-[11px] text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAddress(address.id)}
                            disabled={deletingAddressId === address.id}
                            className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300 disabled:opacity-60"
                          >
                            {deletingAddressId === address.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-gray-400">
                        {formatAddressForDisplay(address)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {showAddressForm && (
                <form
                  onSubmit={saveAddress}
                  className="space-y-3 rounded-2xl border border-white/10 bg-[#222] p-4"
                >
                  <p className="text-sm font-medium text-gray-300">
                    {editingAddressId ? 'Edit Address' : 'Add Address'}
                  </p>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      value={addressForm.label}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, label: event.target.value }))
                      }
                      placeholder="Label (Home/Work)"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.apartment_name}
                      onChange={(event) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          apartment_name: event.target.value,
                        }))
                      }
                      placeholder="Apartment Name"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.flat_number}
                      onChange={(event) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          flat_number: event.target.value,
                        }))
                      }
                      placeholder="Flat / House Number"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.landmark}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, landmark: event.target.value }))
                      }
                      placeholder="Landmark"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                  </div>

                  <textarea
                    value={addressForm.address_line}
                    onChange={(event) =>
                      setAddressForm((prev) => ({
                        ...prev,
                        address_line: event.target.value,
                      }))
                    }
                    placeholder="Address line (street, area, city)"
                    className="h-24 w-full resize-none rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                  />

                  <OSMAddressPicker
                    latitude={addressForm.latitude}
                    longitude={addressForm.longitude}
                    onLocationChange={({
                      latitude,
                      longitude,
                      addressLine,
                      city,
                      state,
                      pincode,
                      country,
                    }) =>
                      setAddressForm((prev) => ({
                        ...prev,
                        latitude,
                        longitude,
                        address_line: addressLine || prev.address_line,
                        city: city || prev.city,
                        state: state || prev.state,
                        pincode: pincode || prev.pincode,
                        country: country || prev.country,
                      }))
                    }
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      value={addressForm.city}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, city: event.target.value }))
                      }
                      placeholder="City"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.state}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, state: event.target.value }))
                      }
                      placeholder="State"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.pincode}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, pincode: event.target.value }))
                      }
                      placeholder="Pincode"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      value={addressForm.country}
                      onChange={(event) =>
                        setAddressForm((prev) => ({ ...prev, country: event.target.value }))
                      }
                      placeholder="Country"
                      className="rounded-xl border border-white/10 bg-[#181818] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <input
                      type="checkbox"
                      checked={addressForm.is_default}
                      onChange={(event) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          is_default: event.target.checked,
                        }))
                      }
                      className="rounded"
                    />
                    Set as default address
                  </label>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelAddressForm}
                      className="rounded-xl border border-white/10 bg-[#181818] px-4 py-2 text-sm text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingAddress}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                    >
                      {savingAddress ? 'Saving...' : 'Save Address'}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#222] p-4">
              <p className="text-sm font-medium text-gray-300">Pickup Options</p>
              <label className="block text-xs text-gray-500">Pickup Date & Time</label>
              <input
                type="datetime-local"
                value={pickupSlot}
                min={pickupMinDatetime}
                onChange={(event) => setPickupSlot(event.target.value)}
                className={`w-full rounded-xl border bg-[#181818] p-3 text-sm text-white [color-scheme:dark] ${pickupSlot && new Date(pickupSlot).getTime() < Date.now() + 30 * 60_000
                  ? 'border-red-500/60'
                  : 'border-white/10'
                  }`}
              />
              {pickupSlot && new Date(pickupSlot).getTime() < Date.now() + 30 * 60_000 ? (
                <p className="text-xs text-red-400">
                  Pickup time must be at least 30 minutes from now.
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  Choose your preferred pickup date and time. Verification code will be generated after payment.
                </p>
              )}
              {pickupCode ? (
                <div className="rounded-xl border border-green-500/25 bg-green-500/10 p-3 text-xs text-green-300">
                  Pickup Code: <span className="font-semibold">{pickupCode}</span>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm text-gray-500">
              Phone Number <span className="text-red-400">*</span>
            </label>
            {user?.id && savedPhones.length > 0 && !useCustomPhone ? (
              <>
                <select
                  value={phone}
                  onChange={(event) => {
                    if (event.target.value === '__custom__') {
                      setUseCustomPhone(true)
                      setPhone('')
                    } else {
                      setPhone(event.target.value)
                    }
                  }}
                  className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
                >
                  {savedPhones.map((sp) => (
                    <option key={sp.id} value={sp.phone}>
                      {sp.phone}
                    </option>
                  ))}
                  <option value="__custom__">Use a different number</option>
                </select>
              </>
            ) : (
              <>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+91 98765 43210"
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                />
                {user?.id && savedPhones.length > 0 && useCustomPhone && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseCustomPhone(false)
                      setPhone(savedPhones[0]?.phone || '')
                    }}
                    className="mt-1 text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    ← Use a saved number
                  </button>
                )}
              </>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-500">
              {orderType === 'pickup' ? 'Order Notes' : 'Delivery Instructions'}
            </label>
            <input
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={
                orderType === 'pickup'
                  ? 'Anything we should know before pickup?'
                  : 'Ring once, leave at security, etc.'
              }
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-gray-500">Payment Method</label>
            <div className="rounded-xl border border-white/10 bg-[#222] px-4 py-3 text-sm font-medium text-white">
              Razorpay (UPI/Card)
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-500">Coupon Code</label>
            <input
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
              placeholder="Optional coupon"
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
            />
          </div>
        </div>

        <div className="sticky top-20 h-fit space-y-5 rounded-2xl border border-white/10 bg-[#181818] p-6">
          <h2 className="text-lg font-semibold">Order Summary</h2>

          {orderType === 'delivery' ? (
            <>
              {selectedAddress ? (
                <div className="rounded-xl border border-white/10 bg-[#222] p-3 text-xs text-gray-400">
                  <p className="mb-1 font-semibold text-white">
                    Delivering to {selectedAddress.label || 'selected address'}
                  </p>
                  <p>{formatAddressForDisplay(selectedAddress)}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
                  Add and select an address to place your order.
                </div>
              )}

              {isOutsideDeliveryRange && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
                  You are {deliveryDistanceCheck?.distanceKm.toFixed(2)} km away by road.
                  If distance is above {MAX_DELIVERY_DISTANCE_KM} km, we recommend visiting
                  the store.
                </div>
              )}

              {isDeliveryDistancePending && (
                <div className="rounded-xl border border-white/10 bg-[#222] p-3 text-xs text-gray-400">
                  Validating delivery distance for this address...
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-white/10 bg-[#222] p-3 text-xs text-gray-400">
              <p className="mb-1 font-semibold text-white">Self Pickup</p>
              <p>
                Pickup:{' '}
                {pickupSlot
                  ? new Date(pickupSlot).toLocaleString([], {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                  : 'Not selected'}
              </p>
              {pickupCode ? <p className="mt-1 text-green-300">Code: {pickupCode}</p> : null}
            </div>
          )}

          <div className="max-h-64 space-y-3 overflow-y-auto">
            {items.map((item) => (
              <div key={item.lineId} className="flex justify-between text-sm">
                <div className="pr-4">
                  <p className="text-gray-200">
                    {item.name} × {item.qty}
                  </p>
                  {item.addons?.length ? (
                    <p className="text-xs text-gray-500">
                      {item.addons.map((addon) => addon.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                <span>₹{item.price * item.qty}</span>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Subtotal</span>
              <span>₹{subtotal}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-green-400">
                <span>{discountLabel || 'Discount'}</span>
                <span>−₹{discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-400">GST (5%)</span>
              <span>₹{tax}</span>
            </div>
            {orderType === 'pickup' ? (
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-gray-400">
                  <input
                    type="checkbox"
                    checked={includePickupPacking}
                    onChange={(event) => setIncludePickupPacking(event.target.checked)}
                    className="h-4 w-4 accent-white"
                  />
                  <span>
                    Packing (₹{PACKING_FEE_PER_ITEM} × {totalItemCount})
                  </span>
                </label>
                <span>₹{packingFee}</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-gray-400">
                  Packing (₹{PACKING_FEE_PER_ITEM} × {totalItemCount})
                </span>
                <span>₹{packingFee}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-2 text-base font-bold">
              <span>Total</span>
              <span>₹{total}</span>
            </div>
          </div>

          <button
            onClick={handlePlaceOrder}
            disabled={placeOrderDisabled}
            className="w-full rounded-xl bg-white py-3 font-semibold text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? 'Processing...'
              : isDeliveryDistancePending
                ? 'Validating delivery range...'
                : orderType === 'pickup' && !pickupSlot
                  ? 'Select pickup date & time'
                  : `Pay ₹${total} with Razorpay`}
          </button>
        </div>
      </div>
    </div>
  )
}
