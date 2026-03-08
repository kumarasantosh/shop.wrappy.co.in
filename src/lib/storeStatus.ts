import { StoreSettingsRecord } from './types'

function timeToMinutes(timeValue: string): number {
  const normalized = timeValue.slice(0, 5)
  const [h, m] = normalized.split(':').map(Number)
  return h * 60 + m
}

function formatTime(timeValue: string): string {
  const [hRaw, mRaw] = timeValue.slice(0, 5).split(':').map(Number)
  const h = hRaw % 12 || 12
  const ampm = hRaw >= 12 ? 'PM' : 'AM'
  const mm = String(mRaw).padStart(2, '0')
  return `${h}:${mm} ${ampm}`
}

export function getDefaultStoreSettings(): StoreSettingsRecord {
  return {
    open_time: '10:00',
    close_time: '22:00',
    allow_preorder: false,
    force_closed: false,
    estimated_delivery_minutes: 30,
  }
}

export function isStoreOpenNow(
  settings: StoreSettingsRecord,
  nowDate: Date = new Date()
): boolean {
  if (settings.force_closed) return false

  const openMins = timeToMinutes(settings.open_time)
  const closeMins = timeToMinutes(settings.close_time)
  const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes()

  if (openMins === closeMins) return true
  if (openMins < closeMins) return nowMins >= openMins && nowMins < closeMins
  return nowMins >= openMins || nowMins < closeMins
}

export function getNextOpeningTime(
  settings: StoreSettingsRecord,
  nowDate: Date = new Date()
): string {
  if (settings.force_closed) return 'Currently closed by admin'
  if (isStoreOpenNow(settings, nowDate)) return 'Open now'

  const openMins = timeToMinutes(settings.open_time)
  const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes()

  if (openMins > nowMins) return `Opens today at ${formatTime(settings.open_time)}`
  return `Opens tomorrow at ${formatTime(settings.open_time)}`
}

export function normalizeStoreSettings(input: Partial<StoreSettingsRecord> | null | undefined): StoreSettingsRecord {
  const defaults = getDefaultStoreSettings()
  if (!input) return defaults

  return {
    open_time: String(input.open_time || defaults.open_time).slice(0, 5),
    close_time: String(input.close_time || defaults.close_time).slice(0, 5),
    allow_preorder: Boolean(input.allow_preorder),
    force_closed: Boolean(input.force_closed),
    estimated_delivery_minutes: Number(input.estimated_delivery_minutes || defaults.estimated_delivery_minutes),
    id: input.id,
  }
}

export function computeEtaIso(minutesFromNow: number, nowDate: Date = new Date()): string {
  const eta = new Date(nowDate.getTime() + Math.max(1, minutesFromNow) * 60_000)
  return eta.toISOString()
}

export function getEtaCountdown(
  eta: string | null | undefined,
  status: string
): { remainingSeconds: number; delayed: boolean } {
  if (!eta || status === 'delivered' || status === 'cancelled') {
    return { remainingSeconds: 0, delayed: false }
  }

  const remainingSeconds = Math.floor((new Date(eta).getTime() - Date.now()) / 1000)
  if (remainingSeconds >= 0) return { remainingSeconds, delayed: false }

  return { remainingSeconds: Math.abs(remainingSeconds), delayed: true }
}
