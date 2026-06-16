import { porterProvider } from './porter'
import type { DeliveryProvider } from './types'

export * from './types'

/**
 * Returns the active last-mile delivery provider. Porter is the only provider.
 * To add another courier, implement the DeliveryProvider interface and switch
 * on DELIVERY_PROVIDER here.
 */
export function getDeliveryProvider(): DeliveryProvider {
  return porterProvider
}

export { porterProvider }
