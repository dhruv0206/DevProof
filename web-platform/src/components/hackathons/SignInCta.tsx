'use client';

/**
 * Reusable "Sign in with GitHub" button used by hackathon admin pages
 * and the invite-acceptance landing page. Wraps BetterAuth's social
 * sign-in with a callbackUrl so the user returns to where they came from.
 */

import { signIn } from '@/lib/auth-client';

interface SignInCtaProps {
    callbackUrl: string;
    label?: string;
}

export function SignInCta({ callbackUrl, label = 'Sign in with GitHub' }: SignInCtaProps) {
    return (
        <button
            type="button"
            onClick={() => signIn.social({ provider: 'github', callbackURL: callbackUrl })}
            className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#CC785C' }}
        >
            <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
            >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2c-3.34.73-4.04-1.61-4.04-1.61-.54-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {label}
        </button>
    );
}
