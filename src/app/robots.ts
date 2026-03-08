import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://wrappy.in'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/api/', '/admin/', '/sign-in/', '/sign-up/'],
            },
        ],
        sitemap: `${siteUrl}/sitemap.xml`,
    }
}
