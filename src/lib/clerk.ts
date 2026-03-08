// Minimal Clerk helper - configure Clerk in _app/layout and use middleware in production.
export const clerkConfig = {
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
  secretKey: process.env.CLERK_SECRET_KEY || ''
}

