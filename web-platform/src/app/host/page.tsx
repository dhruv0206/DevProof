'use client';

/**
 * /host — Organizer landing page.
 *
 * Public page (no auth). Drives white-glove organizer applications via
 * `mailto:` for absolute MVP simplicity. Matches the Clay+Geist
 * techy-minimal aesthetic established on /p/[username]/score and the
 * existing landing components.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { LandingFooter } from '@/components/landing/LandingFooter';

const TEXT_DIM = '#666666';
const ORGANIZER_EMAIL = 'dhruv@devproof.com';

function BracketCorners() {
    const base: React.CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        pointerEvents: 'none',
        borderColor: 'rgba(255,255,255,0.18)',
        borderStyle: 'solid',
        borderWidth: 0,
    };
    return (
        <>
            <span style={{ ...base, top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...base, top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1 }} />
            <span style={{ ...base, bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...base, bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1 }} />
        </>
    );
}

function MoatCard({
    label,
    headline,
    body,
}: {
    label: string;
    headline: string;
    body: string;
}) {
    return (
        <div
            className="relative p-5"
            style={{
                background: 'rgba(255,255,255,0.015)',
                border: '1px solid rgba(255,255,255,0.05)',
            }}
        >
            <BracketCorners />
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-primary mb-2">
                {label}
            </div>
            <div className="text-sm font-medium tracking-tight text-foreground mb-1.5">
                {headline}
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
                {body}
            </div>
        </div>
    );
}

interface FormState {
    name: string;
    email: string;
    hackathon_name: string;
    expected_size: string;
    date: string;
    description: string;
}

function buildMailto(form: FormState): string {
    const subject = `Host application — ${form.hackathon_name || '[hackathon]'}`;
    const lines = [
        `Name: ${form.name}`,
        `Email: ${form.email}`,
        `Hackathon: ${form.hackathon_name}`,
        `Expected participants: ${form.expected_size}`,
        `Event date: ${form.date}`,
        '',
        'About the event:',
        form.description,
    ];
    const body = lines.join('\n');
    const params = new URLSearchParams({ subject, body });
    return `mailto:${ORGANIZER_EMAIL}?${params.toString()}`;
}

function ApplyForm() {
    const [form, setForm] = useState<FormState>({
        name: '',
        email: '',
        hackathon_name: '',
        expected_size: '',
        date: '',
        description: '',
    });

    const required = form.name && form.email && form.hackathon_name;
    const mailtoHref = useMemo(() => buildMailto(form), [form]);

    const inputBase: React.CSSProperties = {
        width: '100%',
        padding: '10px 12px',
        fontSize: 13,
        color: '#EDEDED',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        outline: 'none',
        fontFamily: 'inherit',
    };

    const labelBase = 'font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-1.5 block';

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (!required) return;
                window.location.href = mailtoHref;
            }}
            className="relative p-7 sm:p-8"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <BracketCorners />
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-3">
                <span>APPLY</span>
                <span className="opacity-60 mx-2">·</span>
                <span>WHITE_GLOVE</span>
            </div>
            <h3 className="text-2xl font-semibold tracking-tight mb-1">
                Apply to host on DevProof.
            </h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                We onboard organizers manually during MVP. Tell us about your event
                and we&apos;ll reply with an access code within 24 hours.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                    <label className={labelBase}>Name</label>
                    <input
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        style={inputBase}
                    />
                </div>
                <div>
                    <label className={labelBase}>Email</label>
                    <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        style={inputBase}
                    />
                </div>
            </div>

            <div className="mb-4">
                <label className={labelBase}>Hackathon name</label>
                <input
                    required
                    value={form.hackathon_name}
                    onChange={(e) =>
                        setForm({ ...form, hackathon_name: e.target.value })
                    }
                    style={inputBase}
                    placeholder="HackMIT 2026"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                    <label className={labelBase}>Expected participants</label>
                    <input
                        value={form.expected_size}
                        onChange={(e) =>
                            setForm({ ...form, expected_size: e.target.value })
                        }
                        style={inputBase}
                        placeholder="500"
                    />
                </div>
                <div>
                    <label className={labelBase}>Event date</label>
                    <input
                        value={form.date}
                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                        style={inputBase}
                        placeholder="2026-09-14"
                    />
                </div>
            </div>

            <div className="mb-6">
                <label className={labelBase}>Tell us about it</label>
                <textarea
                    rows={4}
                    value={form.description}
                    onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                    }
                    style={{ ...inputBase, resize: 'vertical', minHeight: 96 }}
                    placeholder="Sponsor packages, format (in-person / virtual / hybrid), prize tiers..."
                />
            </div>

            <Button type="submit" size="lg" disabled={!required} className="w-full">
                Submit application
            </Button>

            <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground mt-4 text-center">
                <span style={{ color: TEXT_DIM }}>// </span>
                opens your mail client — we&apos;ll reply within 24h
            </p>
        </form>
    );
}

export default function HostLandingPage() {
    return (
        <div className="min-h-screen bg-background">
            <LandingNavbar />

            <main className="relative pt-32 pb-20 px-4">
                <div className="max-w-4xl mx-auto">
                    {/* Hero */}
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="text-center mb-16"
                    >
                        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-4">
                            <span>FOR ORGANIZERS</span>
                            <span className="opacity-60 mx-2">·</span>
                            <span>V1.0</span>
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-bold leading-[1.05] mb-5 tracking-tight max-w-3xl mx-auto">
                            Host a hackathon.
                            <br />
                            <span className="bg-gradient-to-r from-[#CC785C] via-[#D4866A] to-[#B5654E] bg-clip-text text-transparent">
                                Get objective scores on every submission.
                            </span>
                        </h1>
                        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                            DevProof reads every submission&apos;s repository line by line and
                            returns a defensible engineering score, sponsor matches, and
                            a publishable leaderboard. Stop relying on demo theatre.
                        </p>
                    </motion.div>

                    {/* Moat strip */}
                    <motion.section
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.5 }}
                        className="mb-16"
                    >
                        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-4 text-center">
                            <span>WHY_DEVPROOF</span>
                        </div>
                        <div className="grid md:grid-cols-3 gap-4">
                            <MoatCard
                                label="SEEN"
                                headline="Every submission, read line by line."
                                body="No more 5-minute demo bias. Each repo gets the attention a senior reviewer would give it — at scale."
                            />
                            <MoatCard
                                label="HONEST"
                                headline="UI polish can't masquerade as deep tech."
                                body="Tier caps prevent flashy frontends from outscoring serious systems work. Sponsor matches verify package usage."
                            />
                            <MoatCard
                                label="WHOLE"
                                headline="Defensible numbers, every time."
                                body="Engineering depth and reach, never collapsed. Every claim cites real lines of code. Publishable to your community."
                            />
                        </div>
                    </motion.section>

                    {/* How it works strip */}
                    <motion.section
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.5 }}
                        className="mb-16"
                    >
                        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-4 text-center">
                            <span>HOW IT WORKS</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[
                                {
                                    n: '01',
                                    title: 'Apply + receive an access code',
                                    body: 'We onboard your event manually. You send the code to participants when registration opens.',
                                },
                                {
                                    n: '02',
                                    title: 'Devs submit their GitHub repo',
                                    body: 'Every submission triggers a deep V4 audit. Sponsor packages are auto-detected at audit time.',
                                },
                                {
                                    n: '03',
                                    title: 'Judge from the dashboard',
                                    body: 'Filter, compare, assign awards. Publish the leaderboard with one click when judging closes.',
                                },
                            ].map((step) => (
                                <div
                                    key={step.n}
                                    className="relative p-5"
                                    style={{
                                        background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <BracketCorners />
                                    <div
                                        className="font-mono"
                                        style={{
                                            fontSize: 10,
                                            color: 'var(--clay)',
                                            letterSpacing: '0.12em',
                                            marginBottom: 10,
                                        }}
                                    >
                                        {step.n}
                                    </div>
                                    <div className="text-sm font-medium tracking-tight mb-2">
                                        {step.title}
                                    </div>
                                    <div className="text-xs text-muted-foreground leading-relaxed">
                                        {step.body}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.section>

                    {/* Apply form */}
                    <motion.section
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25, duration: 0.5 }}
                        id="apply"
                        className="mb-12"
                    >
                        <ApplyForm />
                    </motion.section>

                    {/* Footnote */}
                    <div className="text-center">
                        <p className="font-mono text-[11px] text-muted-foreground tracking-[0.04em]">
                            <span style={{ color: TEXT_DIM }}>// </span>
                            Already organizing? Email{' '}
                            <a
                                href={`mailto:${ORGANIZER_EMAIL}`}
                                className="text-primary hover:underline"
                            >
                                {ORGANIZER_EMAIL}
                            </a>{' '}
                            or open your event from{' '}
                            <Link href="/hackathons" className="text-primary hover:underline">
                                /hackathons
                            </Link>
                            .
                        </p>
                    </div>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
