'use client';

/**
 * Code-paste login form for non-dev hackathon organizers.
 *
 * Posts to the Next.js route handler at
 * `/api/hackathons/{slug}/admin-auth`, which validates against FastAPI
 * and on success sets an httpOnly cookie. The cookie is then forwarded
 * to FastAPI on every admin request as `X-Hackathon-Admin-Code` (see
 * `lib/hackathons.ts`).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXT_DIM = '#666666';

export function AdminLoginForm({ slug }: { slug: string }) {
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/hackathons/${encodeURIComponent(slug)}/admin-auth`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: code.trim() }),
                },
            );
            if (res.ok) {
                router.push(`/hackathons/${slug}/admin`);
                router.refresh();
                return;
            }
            if (res.status === 403) {
                setError('Code is incorrect. Double-check the email from DevProof.');
            } else {
                setError(`Login failed (status ${res.status}).`);
            }
        } catch {
            setError('Network error — could not reach DevProof.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
                <label
                    htmlFor="admin_code"
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        display: 'block',
                    }}
                >
                    ADMIN_CODE
                </label>
                <Input
                    id="admin_code"
                    name="admin_code"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    spellCheck={false}
                    placeholder="paste the organizer admin code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={submitting}
                    className="font-mono tracking-wider"
                />
                <p
                    className="font-mono"
                    style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    DevProof emails this code when your event is provisioned. It&apos;s
                    different from the participant access code.
                </p>
            </div>

            {error && (
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
                        ERROR
                    </div>
                    <div>{error}</div>
                </div>
            )}

            <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                disabled={!code.trim() || submitting}
            >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Verifying…' : 'Open admin →'}
            </Button>
        </form>
    );
}
