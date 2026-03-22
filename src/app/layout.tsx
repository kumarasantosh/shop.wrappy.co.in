import './globals.css'
import React from 'react'
import { ClerkProvider } from '@clerk/nextjs'
import { Cormorant_Garamond, Manrope } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import { SupabaseProvider } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { RestaurantSchema, WebsiteSchema } from '../components/SeoSchema'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://wrappy.in'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Wrappy — Order Premium Food Online | Pickup in Hyderabad',
    template: '%s | Wrappy',
  },
  description:
    'Order burgers, wraps, shakes & more from Wrappy — Hyderabad\'s premium fast food restaurant. Self pickup, live order tracking, and secure online payment.',
  keywords: [
    'Wrappy',
    'Wrappy Hyderabad',
    'order food online Hyderabad',
    'food ordering',
    'restaurant delivery Hyderabad',
    'self pickup restaurant',
    'online food order',
    'premium burgers Hyderabad',
    'wraps near me',
    'milkshakes Hyderabad',
    'fast food Hyderabad',
    'best burgers Hyderabad',
    'food delivery app',
  ],
  applicationName: 'Wrappy',
  authors: [{ name: 'Wrappy' }],
  creator: 'Wrappy',
  publisher: 'Wrappy',
  formatDetection: {
    telephone: true,
    email: false,
    address: true,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Wrappy',
    title: 'Wrappy — Order Premium Food Online | Hyderabad',
    description:
      'Order burgers, wraps, shakes & more. Self pickup, live tracking, secure payments. Hyderabad\'s premium fast food experience.',
    locale: 'en_IN',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Wrappy — Premium Food Ordering',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wrappy — Order Premium Food Online',
    description:
      'Order burgers, wraps, shakes & more from Wrappy in Hyderabad. Self pickup, live tracking, and secure payments.',
    images: ['/og-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  category: 'food',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0F0F0F',
}

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
})

const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body
        className={`${bodyFont.variable} ${displayFont.variable} min-h-screen bg-[#0F0F0F] text-white`}
      >
        <RestaurantSchema />
        <WebsiteSchema />
        <ClerkProvider>
          <SupabaseProvider>
            <div className="w-full bg-amber-500 text-amber-950 py-2.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 z-[100] relative shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              We are currently under maintenance. Some features may be temporarily unavailable.
            </div>
            <Navbar />
            <main className="max-w-6xl mx-auto px-4 pb-24">{children}</main>
          </SupabaseProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
