/**
 * Provider-neutral last-mile delivery interface.
 *
 * The app talks to this interface; concrete couriers (Porter, …) implement it.
 * The active provider is returned by getDeliveryProvider() in ./index.
 * All money values crossing this boundary are in whole rupees.
 */

export type AppOrderStatus =
  | 'placed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type QuoteInput = {
  dropoffAddress: string
  dropoffLatitude?: number
  dropoffLongitude?: number
  dropoffPhoneNumber?: string
  /** Order subtotal in rupees. */
  subtotalRupees?: number
}

export type Quote = {
  quoteId: string | null
  feeRupees: number
  currency: string
  etaMinutes?: number
}

export type DeliveryItem = {
  name: string
  quantity: number
  priceRupees?: number
}

export type CreateDeliveryInput = {
  quoteId?: string | null
  orderId: string
  dropoffName: string
  dropoffAddress: string
  dropoffPhoneNumber: string
  dropoffLatitude?: number
  dropoffLongitude?: number
  dropoffNotes?: string
  items: DeliveryItem[]
  subtotalRupees?: number
}

export type Delivery = {
  id: string
  status: string
  trackingUrl?: string
  feeRupees?: number
  currency?: string
  raw: unknown
}

export type ParsedWebhook = {
  deliveryId?: string
  externalId?: string
  rawStatus?: string
  mappedStatus: AppOrderStatus | null
  trackingUrl?: string
}

export interface DeliveryProvider {
  readonly name: string
  isConfigured(): boolean
  isPickupConfigured(): boolean
  createQuote(input: QuoteInput): Promise<Quote>
  createDelivery(input: CreateDeliveryInput): Promise<Delivery>
  getDelivery(id: string): Promise<Delivery>
  cancelDelivery(id: string): Promise<Delivery>
  verifyWebhook(rawBody: string, headers: Headers): boolean
  parseWebhook(event: any): ParsedWebhook
}
