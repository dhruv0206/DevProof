import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

export const authClient = createAuthClient({
  // baseURL is optional if auth server is on same domain
});

export const { signIn, signUp, signOut, useSession } = authClient;


/**
 * Discriminator hook: returns whether the current session belongs to a
 * developer (has linked GitHub OAuth account) or an organizer-only user.
 *
 *   signedIn=true,  isDeveloper=true  → full developer UI (current default)
 *   signedIn=true,  isDeveloper=false → organizer-only (magic-link sign-in);
 *                                       hide developer CTAs, show hackathon chip
 *   signedIn=false                    → logged out
 *
 * Caches result in module-level state for the session lifetime so each
 * page render doesn't re-fetch. Cache is cleared on sign-out.
 */
export interface DevStatus {
    signedIn: boolean;
    isDeveloper: boolean;
    name: string | null;
    loading: boolean;
}

let _cached: Omit<DevStatus, 'loading'> | null = null;

export function useDevStatus(): DevStatus {
    const [state, setState] = useState<DevStatus>(() =>
        _cached ? { ..._cached, loading: false } : {
            signedIn: false, isDeveloper: false, name: null, loading: true,
        },
    );

    useEffect(() => {
        if (_cached) return;
        let alive = true;
        fetch('/api/auth/me/dev-status', { cache: 'no-store' })
            .then(r => r.json())
            .then((data: Omit<DevStatus, 'loading'>) => {
                if (!alive) return;
                _cached = data;
                setState({ ...data, loading: false });
            })
            .catch(() => {
                if (!alive) return;
                setState({
                    signedIn: false, isDeveloper: false, name: null, loading: false,
                });
            });
        return () => { alive = false; };
    }, []);

    return state;
}

/** Clear the cached dev-status. Call after sign-out. */
export function clearDevStatusCache(): void {
    _cached = null;
}
