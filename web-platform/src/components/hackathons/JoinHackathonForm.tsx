'use client';

/**
 * Client form for /hackathons/[slug]/join.
 *
 * Submits the access code to `POST /api/hackathons/{slug}/join`. On success
 * (200) — including the 409 "already joined" case which the backend treats
 * as success — redirects to the submission page. On 403/404 we surface a
 * structured inline error with mono-cap styling.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXT_DIM = '#666666';

type Status = 'idle' | 'submitting' | 'error';

export function JoinHackathonForm({
    slug,
    eventName,
    userId,
}: {
    slug: string;
    eventName: string | null;
    userId: string;
}) {
    const [accessCode, setAccessCode] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [errorCode, setErrorCode] = useState<'WRONG_CODE' | 'NOT_FOUND' | 'GENERIC' | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!accessCode.trim() || status === 'submitting') return;

        setStatus('submitting');
        setErrorCode(null);
        setErrorMessage(null);

        try {
            // Go through the Next proxy so the internal-proxy secret + session
            // user-id are injected server-side (client can't carry the secret).
            const res = await fetch(`/api/hackathons-proxy/${encodeURIComponent(slug)}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_code: accessCode.trim() }),
            });

            // 200 (joined) and 409 (already joined) both mean: continue.
            // Use a hard navigation — Next.js's RSC payload cache can serve a
            // stale role=null view of /submit after a soft router.push, which
            // bounces the freshly-joined user back to /join in a redirect loop.
            if (res.ok || res.status === 409) {
                window.location.assign(`/hackathons/${slug}/submit`);
                return;
            }

            if (res.status === 403) {
                setErrorCode('WRONG_CODE');
                setErrorMessage('Access code is incorrect. Double-check the email from the organizer.');
            } else if (res.status === 404) {
                setErrorCode('NOT_FOUND');
                setErrorMessage(`No hackathon found at /${slug}.`);
            } else {
                const body = await res.json().catch(() => null);
                setErrorCode('GENERIC');
                setErrorMessage(
                    typeof body?.detail === 'string'
                        ? body.detail
                        : 'Something went wrong. Try again in a moment.',
                );
            }
            setStatus('error');
        } catch {
            setErrorCode('GENERIC');
            setErrorMessage('Network error — could not reach the DevProof API.');
            setStatus('error');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
                <label
                    htmlFor="access_code"
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        display: 'block',
                    }}
                >
                    ACCESS_CODE
                </label>
                <Input
                    id="access_code"
                    name="access_code"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    spellCheck={false}
                    placeholder="paste the code from the organizer email"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    disabled={status === 'submitting'}
                    className="font-mono tracking-wider"
                />
                <p
                    className="font-mono"
                    style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    {eventName
                        ? `Joining ${eventName} as a participant.`
                        : `Joining /${slug} as a participant.`}
                </p>
            </div>

            {status === 'error' && errorCode && (
                <div
                    className="font-mono"
                    style={{
                        padding: '12px 14px',
                        border: '1px solid rgba(239,68,68,0.35)',
                        background: 'rgba(239,68,68,0.06)',
                        fontSize: 12,
                        color: '#FCA5A5',
                        lineHeight: 1.5,
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 4,
                            color: '#FCA5A5',
                        }}
                    >
                        ERROR · {errorCode}
                    </div>
                    <div>{errorMessage}</div>
                </div>
            )}

            <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                disabled={!accessCode.trim() || status === 'submitting'}
            >
                {status === 'submitting' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'submitting' ? 'Verifying access code...' : 'Join hackathon →'}
            </Button>
        </form>
    );
}
