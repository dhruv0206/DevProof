/**
 * Server-only helper for Next.js → FastAPI proxies.
 *
 * Builds the headers that authorize a server-side call from Next to
 * FastAPI:
 *   • ``X-User-Id``               — the resolved BetterAuth session
 *                                   user-id (omitted for anonymous
 *                                   callers)
 *   • ``X-Internal-Proxy-Secret`` — shared secret proving the request
 *                                   originated from the trusted Next.js
 *                                   layer (not a curl from the public
 *                                   internet). Pulled from
 *                                   ``INTERNAL_PROXY_SECRET`` env var,
 *                                   which is server-only — never expose
 *                                   it with a ``NEXT_PUBLIC_`` prefix.
 *
 * The secret is only injected when the env var is set, so local dev
 * without any secret configured continues to work unchanged.
 *
 * IMPORTANT: never import this from a client component. The secret would
 * not be available (server-only env), and importing it would also pull
 * in `next/headers` which throws in client code.
 */

import { headers as nextHeaders } from 'next/headers';
import { auth } from '@/lib/auth';

export interface BuildProxyHeadersOptions {
    /** Additional headers to merge in (e.g. Content-Type). */
    extra?: Record<string, string>;
    /** If true, omit Content-Type. Useful for GET passthroughs. */
    noContentType?: boolean;
}

/**
 * Standard proxy-call header set. Reads the current BetterAuth session
 * and produces a Record<string, string> ready to pass to ``fetch``.
 */
export async function buildProxyHeaders(
    opts: BuildProxyHeadersOptions = {},
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!opts.noContentType) out['Content-Type'] = 'application/json';

    const secret = process.env.INTERNAL_PROXY_SECRET;
    if (secret) out['X-Internal-Proxy-Secret'] = secret;

    try {
        const session = await auth.api.getSession({
            headers: await nextHeaders(),
        });
        if (session?.user?.id) out['X-User-Id'] = session.user.id;
    } catch {
        // Anonymous — backend returns 401/403 as appropriate.
    }

    if (opts.extra) Object.assign(out, opts.extra);
    return out;
}

/** FastAPI base URL. Falls back to local dev when unset. */
export const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
