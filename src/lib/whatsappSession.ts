// src/lib/whatsappSession.ts
// Supabase-backed session store for WhatsApp order flow.
// Each customer's phone number is their session key.

import { supabaseAdmin } from './supabaseAdmin'

export interface WhatsAppSession {
  id?: string
  phone: string
  state: string
  name?: string
  item_number?: number
  item_name?: string
  item_price?: number
  qty?: number
  address?: string
  subtotal?: number
  delivery_charge?: number
  total?: number
  order_id?: string
  payment_link?: string
  created_at?: string
  updated_at?: string
}

/** Get session for a phone number — returns null if not found */
export async function getSession(phone: string): Promise<WhatsAppSession | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone', phone)
    .single()

  if (error || !data) return null
  return data as WhatsAppSession
}

/** Create or fully replace a session */
export async function setSession(
  phone: string,
  updates: Partial<WhatsAppSession>
): Promise<WhatsAppSession> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_sessions')
    .upsert({ phone, ...updates }, { onConflict: 'phone' })
    .select()
    .single()

  if (error) throw new Error('setSession failed: ' + error.message)
  return data as WhatsAppSession
}

/** Update specific fields on an existing session */
export async function updateSession(
  phone: string,
  updates: Partial<WhatsAppSession>
): Promise<WhatsAppSession> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_sessions')
    .update(updates)
    .eq('phone', phone)
    .select()
    .single()

  if (error) throw new Error('updateSession failed: ' + error.message)
  return data as WhatsAppSession
}

/** Delete session (e.g. on CANCEL or after order confirmed) */
export async function clearSession(phone: string): Promise<void> {
  await supabaseAdmin.from('whatsapp_sessions').delete().eq('phone', phone)
}
