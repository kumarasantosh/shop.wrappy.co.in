export type ProductAddon = {
  id: string
  name: string
  price: number
}

export type CategoryRecord = {
  id: string
  name: string
  position: number
}

export type ProductRecord = {
  id: string
  name: string
  description: string | null
  price: number
  is_veg: boolean
  is_available: boolean
  category_id: string | null
  image_url: string | null
  addons: ProductAddon[] | null
  created_at?: string
  category?: CategoryRecord | null
}

export type CouponType = 'percent' | 'flat' | 'first_order'

export type CouponRecord = {
  id: string
  code: string
  type: CouponType
  value: number
  min_order: number
  usage_limit: number
  used_count: number
  expires_at: string | null
  is_active: boolean
}

export type StoreSettingsRecord = {
  id?: string
  open_time: string
  close_time: string
  allow_preorder: boolean
  force_closed: boolean
  estimated_delivery_minutes: number
}

export type AddressRecord = {
  id: string
  customer_clerk_id: string
  label: string | null
  address_line: string
  apartment_name: string | null
  flat_number: string | null
  landmark: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  country?: string | null
  latitude: number | null
  longitude: number | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export type OrderStatus =
  | 'placed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type OrderRecord = {
  id: string
  customer_clerk_id: string | null
  status: OrderStatus
  subtotal: number
  discount: number
  tax: number
  packing_fee?: number | null
  delivery_fee: number
  total: number
  coupon_code: string | null
  address: string | null
  phone: string | null
  instructions: string | null
  payment_method: string | null
  payment_status: string | null
  eta: string | null
  estimated_delivery_minutes?: number | null
  delivery_time: string | null
  created_at: string
  updated_at?: string | null
  order_items?: OrderItemRecord[] | null
}

export type OrderLineProduct = {
  id: string
  name: string
  image_url: string | null
  is_veg: boolean
}

export type OrderItemRecord = {
  id: string
  order_id: string
  product_id: string
  qty: number
  price: number
  line_total?: number | string | null
  addons: ProductAddon[] | null
  product?: OrderLineProduct | null
}

export type CustomerPhoneRecord = {
  id: string
  customer_clerk_id: string
  phone: string
  created_at: string
}
