Deployment & Notes

- Admin access: set CLERK_ADMIN_USER_IDS in .env.local (comma-separated Clerk user ids) or implement role mapping in Supabase.
- Use SUPABASE_SERVICE_ROLE_KEY only on server-side; never expose it to the browser.
- Configure Razorpay webhook secret to point to: /api/razorpay/webhook
- Set NEXT_PUBLIC_APP_URL to your production domain for Clerk callbacks.

Storage:
- Create a Supabase Storage bucket named `product-images` and enable public access or configure signed URLs.

Notes:
- Admin image uploads use /api/upload which stores images under `product-images/products/...`

Quick checklist:
1. npm install
2. Populate .env.local from .env.example
3. Run Supabase SQL scripts in your Supabase project (schema.sql, seeds.sql)
4. Start dev server: npm run dev

