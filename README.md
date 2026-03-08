# Wrappy — Premium Restaurant Web (Next.js 14)

This repository is a scaffold for a single-restaurant food ordering web app built with:
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Framer Motion
- Zustand (cart)
- Supabase (DB + realtime)
- Clerk (auth)
- Razorpay (payments)

Features scaffolded:
- Home, Menu, Cart, Checkout, Orders pages
- Admin panel skeleton
- Supabase schema + seeds
- Razorpay server routes (create order + webhook)
- Zustand cart store

Setup
1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill values.
3. Start dev server: `npm run dev`

Env variables (see .env.example)

Supabase
- Run `supabase/schema.sql` in your Supabase project to create tables.
- Seed using `supabase/seeds.sql` (adjust category ids as needed).

Notes
- This scaffold provides UI and server routes skeletons. Wire Clerk middleware, secure server keys, and complete Supabase integration before production.

# shop
