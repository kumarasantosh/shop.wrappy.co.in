import React from 'react'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://wrappy.in'

export function RestaurantSchema() {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        name: 'Wrappy',
        url: siteUrl,
        logo: `${siteUrl}/logo.png`,
        image: `${siteUrl}/og-image.jpg`,
        description:
            'Wrappy is a premium food ordering restaurant in Hyderabad offering burgers, wraps, shakes, and more with self-pickup and online ordering.',
        telephone: '+91-XXXXXXXXXX',
        address: {
            '@type': 'PostalAddress',
            addressLocality: 'Hyderabad',
            addressRegion: 'Telangana',
            addressCountry: 'IN',
        },
        geo: {
            '@type': 'GeoCoordinates',
            latitude: '17.385',
            longitude: '78.4867',
        },
        priceRange: '₹₹',
        servesCuisine: ['Burgers', 'Wraps', 'Shakes', 'Fast Food'],
        hasMenu: `${siteUrl}/menu`,
        acceptsReservations: false,
        openingHoursSpecification: [
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: [
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday',
                ],
                opens: '10:00',
                closes: '23:00',
            },
        ],
        potentialAction: {
            '@type': 'OrderAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${siteUrl}/menu`,
                actionPlatform: 'https://schema.org/DesktopWebPlatform',
            },
            deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModePickUp',
        },
        sameAs: [],
    }

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    )
}

export function WebsiteSchema() {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Wrappy',
        url: siteUrl,
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${siteUrl}/menu?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
        },
    }

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    )
}

export function BreadcrumbSchema({
    items,
}: {
    items: { name: string; url: string }[]
}) {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url.startsWith('http') ? item.url : `${siteUrl}${item.url}`,
        })),
    }

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    )
}

export function FAQSchema({
    questions,
}: {
    questions: { question: string; answer: string }[]
}) {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: questions.map((q) => ({
            '@type': 'Question',
            name: q.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: q.answer,
            },
        })),
    }

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    )
}
