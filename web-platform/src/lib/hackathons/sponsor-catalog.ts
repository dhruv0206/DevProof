/**
 * Curated catalog of common hackathon sponsors with their canonical
 * npm / pypi package names. Lets organizers add sponsors by picking
 * from a dropdown rather than guessing what packages to type.
 *
 * This is frontend-only (no API call, no DB). Updates ship via code.
 * Custom sponsors not in this list fall back to manual entry in the
 * SponsorsManagerClient.
 *
 * The `packages` here drive the algo's `match_sponsors` cross-reference
 * — they must be the exact import names (`@scope/pkg` for scoped npm,
 * lowercase for pypi). Aliases / older names are included where they're
 * still in active use.
 */

export interface SponsorCatalogEntry {
    /** Display name (what shows up in the dropdown + on the leaderboard). */
    name: string;
    /** Short category tag for filtering. */
    category:
        | 'auth'
        | 'database'
        | 'ai'
        | 'email'
        | 'payments'
        | 'observability'
        | 'storage'
        | 'analytics'
        | 'devtools'
        | 'platform'
        | 'communication'
        | 'misc';
    /** Canonical npm/pypi packages this sponsor offers. Algo matches
     * against these names in each submission's audited code. */
    packages: string[];
    /** Optional one-liner shown in the dropdown for context. */
    blurb?: string;
}

export const SPONSOR_CATALOG: SponsorCatalogEntry[] = [
    // ── AI / LLM providers ─────────────────────────────────────────
    {
        name: 'OpenAI',
        category: 'ai',
        packages: ['openai'],
        blurb: 'GPT models, embeddings, vision API',
    },
    {
        name: 'Anthropic',
        category: 'ai',
        packages: ['@anthropic-ai/sdk', 'anthropic'],
        blurb: 'Claude models — Sonnet, Opus, Haiku',
    },
    {
        name: 'Vercel AI SDK',
        category: 'ai',
        packages: ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic'],
        blurb: 'Multi-provider streaming + tool-use SDK',
    },
    {
        name: 'Replicate',
        category: 'ai',
        packages: ['replicate'],
        blurb: 'Open-source model hosting',
    },
    {
        name: 'Hugging Face',
        category: 'ai',
        packages: ['@huggingface/inference', 'huggingface_hub'],
        blurb: 'Inference API + model hub',
    },
    {
        name: 'LangChain',
        category: 'ai',
        packages: ['langchain', '@langchain/core', '@langchain/openai', '@langchain/anthropic'],
        blurb: 'LLM orchestration framework',
    },
    {
        name: 'Pinecone',
        category: 'ai',
        packages: ['@pinecone-database/pinecone', 'pinecone-client'],
        blurb: 'Managed vector database',
    },
    {
        name: 'ElevenLabs',
        category: 'ai',
        packages: ['elevenlabs', '@elevenlabs/elevenlabs-js'],
        blurb: 'Text-to-speech + voice cloning',
    },
    {
        name: 'Tavily',
        category: 'ai',
        packages: ['@tavily/core', 'tavily-python'],
        blurb: 'AI-native search API for agents',
    },

    // ── Auth ───────────────────────────────────────────────────────
    {
        name: 'Clerk',
        category: 'auth',
        packages: ['@clerk/nextjs', '@clerk/clerk-react', '@clerk/clerk-sdk-node'],
        blurb: 'Drop-in auth with managed UI',
    },
    {
        name: 'Auth0',
        category: 'auth',
        packages: ['@auth0/auth0-react', '@auth0/nextjs-auth0', 'auth0'],
        blurb: 'Enterprise-grade auth platform',
    },
    {
        name: 'BetterAuth',
        category: 'auth',
        packages: ['better-auth', '@better-auth/cli'],
        blurb: 'Self-hosted auth library',
    },

    // ── Database / Backend ─────────────────────────────────────────
    {
        name: 'Supabase',
        category: 'database',
        packages: ['@supabase/supabase-js', '@supabase/ssr', 'supabase'],
        blurb: 'Postgres + auth + storage + realtime',
    },
    {
        name: 'Convex',
        category: 'database',
        packages: ['convex', '@convex-dev/auth'],
        blurb: 'Realtime backend with reactive queries',
    },
    {
        name: 'Neon',
        category: 'database',
        packages: ['@neondatabase/serverless'],
        blurb: 'Serverless Postgres',
    },
    {
        name: 'PlanetScale',
        category: 'database',
        packages: ['@planetscale/database'],
        blurb: 'Serverless MySQL',
    },
    {
        name: 'MongoDB',
        category: 'database',
        packages: ['mongodb', 'mongoose'],
        blurb: 'Document database',
    },
    {
        name: 'Drizzle ORM',
        category: 'database',
        packages: ['drizzle-orm', 'drizzle-kit'],
        blurb: 'TypeScript ORM',
    },
    {
        name: 'Prisma',
        category: 'database',
        packages: ['@prisma/client', 'prisma'],
        blurb: 'Type-safe ORM with migrations',
    },

    // ── Email / Communication ──────────────────────────────────────
    {
        name: 'Resend',
        category: 'email',
        packages: ['resend', '@resend/node'],
        blurb: 'Transactional email API',
    },
    {
        name: 'SendGrid',
        category: 'email',
        packages: ['@sendgrid/mail', 'sendgrid'],
        blurb: 'Email infrastructure',
    },
    {
        name: 'Postmark',
        category: 'email',
        packages: ['postmark'],
        blurb: 'Transactional email delivery',
    },
    {
        name: 'Twilio',
        category: 'communication',
        packages: ['twilio'],
        blurb: 'SMS, voice, WhatsApp API',
    },
    {
        name: 'Slack',
        category: 'communication',
        packages: ['@slack/web-api', '@slack/bolt', 'slack-sdk'],
        blurb: 'Workspace messaging API',
    },

    // ── Payments ───────────────────────────────────────────────────
    {
        name: 'Stripe',
        category: 'payments',
        packages: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'],
        blurb: 'Payments + subscriptions',
    },
    {
        name: 'PayPal',
        category: 'payments',
        packages: ['@paypal/react-paypal-js', 'paypal-rest-sdk'],
        blurb: 'Payment processing',
    },

    // ── Storage / Files ────────────────────────────────────────────
    {
        name: 'Vercel Blob',
        category: 'storage',
        packages: ['@vercel/blob'],
        blurb: 'Object storage for Vercel apps',
    },
    {
        name: 'Cloudinary',
        category: 'storage',
        packages: ['cloudinary', 'next-cloudinary'],
        blurb: 'Image + video CDN',
    },
    {
        name: 'AWS S3',
        category: 'storage',
        packages: ['@aws-sdk/client-s3'],
        blurb: 'Object storage',
    },
    {
        name: 'UploadThing',
        category: 'storage',
        packages: ['uploadthing', '@uploadthing/react'],
        blurb: 'File uploads for Next.js',
    },

    // ── Observability / Errors ─────────────────────────────────────
    {
        name: 'Sentry',
        category: 'observability',
        packages: ['@sentry/nextjs', '@sentry/react', '@sentry/node'],
        blurb: 'Error tracking + perf monitoring',
    },
    {
        name: 'Logfire',
        category: 'observability',
        packages: ['logfire'],
        blurb: 'Pydantic observability platform',
    },
    {
        name: 'Axiom',
        category: 'observability',
        packages: ['@axiomhq/js', 'next-axiom'],
        blurb: 'Logs + analytics for serverless',
    },

    // ── Analytics ──────────────────────────────────────────────────
    {
        name: 'PostHog',
        category: 'analytics',
        packages: ['posthog-js', 'posthog-node'],
        blurb: 'Product analytics + feature flags',
    },
    {
        name: 'Mixpanel',
        category: 'analytics',
        packages: ['mixpanel', 'mixpanel-browser'],
        blurb: 'Event analytics',
    },

    // ── Devtools / Platform ────────────────────────────────────────
    {
        name: 'Vercel',
        category: 'platform',
        packages: ['@vercel/kv', '@vercel/postgres', '@vercel/edge-config'],
        blurb: 'Vercel platform SDKs',
    },
    {
        name: 'Linear',
        category: 'devtools',
        packages: ['@linear/sdk'],
        blurb: 'Issue tracker API',
    },
    {
        name: 'GitHub',
        category: 'devtools',
        packages: ['@octokit/rest', '@octokit/core', 'octokit'],
        blurb: 'GitHub REST + GraphQL APIs',
    },
];

export function findCatalogEntry(name: string): SponsorCatalogEntry | undefined {
    const needle = name.trim().toLowerCase();
    return SPONSOR_CATALOG.find((s) => s.name.toLowerCase() === needle);
}

export function searchCatalog(query: string): SponsorCatalogEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return SPONSOR_CATALOG;
    return SPONSOR_CATALOG.filter(
        (s) =>
            s.name.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            s.packages.some((p) => p.toLowerCase().includes(q)) ||
            (s.blurb || '').toLowerCase().includes(q),
    );
}
