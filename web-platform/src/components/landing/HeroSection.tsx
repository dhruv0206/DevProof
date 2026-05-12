'use client';

import { motion } from 'framer-motion';
import { DotPattern } from '@/components/ui/dot-pattern';
import { useEffect, useState } from 'react';
import { getStats } from '@/lib/api';


/* ── Animated counter ── */
function AnimatedNumber({ value }: { value: number }) {
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        if (value === 0) return;
        const duration = 1500;
        const start = performance.now();
        const animate = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(eased * value));
            if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }, [value]);

    return <>{display.toLocaleString()}</>;
}


/* ── Bracket corner accents (10px L-shapes at 18% white-alpha) ── */
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


/* ── Verified profile card — uses our actual design system ── */

interface SampleProfile {
    name: string;
    role: string;
    yrs: string;
    langs: string[];
    depth: number;
    reach: number;
    topClaim: { tier: string; title: string; evidence: string[] };
    audited: number;
    ossPRs: number;
}

const SAMPLE_PROFILES: SampleProfile[] = [
    {
        name: 'Alex Chen',
        role: 'Senior Backend Engineer',
        yrs: '8 years',
        langs: ['Python', 'Rust', 'Distributed Systems'],
        depth: 82,
        reach: 47,
        topClaim: {
            tier: 'Deep technical work',
            title: 'Multi-region database failover',
            evidence: ['db/replication.py:142', 'db/failover.py:88'],
        },
        audited: 7,
        ossPRs: 23,
    },
    {
        name: 'Maya Singh',
        role: 'Senior Frontend Engineer',
        yrs: '5 years',
        langs: ['TypeScript', 'React', 'WebGL'],
        depth: 71,
        reach: 64,
        topClaim: {
            tier: 'Strong feature engineering',
            title: 'GPU-accelerated 3D scene graph',
            evidence: ['src/gl/scene.ts:204', 'src/hooks/useFrame.ts:58'],
        },
        audited: 9,
        ossPRs: 15,
    },
    {
        name: 'Rae Kim',
        role: 'ML Engineer',
        yrs: '6 years',
        langs: ['Python', 'PyTorch', 'CUDA'],
        depth: 88,
        reach: 38,
        topClaim: {
            tier: 'Deep technical work',
            title: 'Custom CUDA kernel for sparse attention',
            evidence: ['kernels/sparse_attn.cu:64', 'src/model/layer.py:122'],
        },
        audited: 4,
        ossPRs: 11,
    },
];

/** AxisBlock — dual-axis card with plain-English label + helper */
function AxisBlock({
    label, helper, score, isPrimary,
}: { label: string; helper: string; score: number; isPrimary: boolean }) {
    return (
        <div
            className="relative px-6 py-6"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <BracketCorners />
            <div className="text-[13px] font-medium text-foreground/90 mb-1.5">
                {label}
            </div>
            <div className="flex items-baseline gap-2">
                <span
                    className="font-mono tabular-nums"
                    style={{
                        fontSize: 44,
                        fontWeight: 500,
                        color: isPrimary ? 'var(--clay)' : '#EDEDED',
                        letterSpacing: '-0.03em',
                        lineHeight: 1,
                    }}
                >
                    {score}
                </span>
                <span className="font-mono text-xs text-muted-foreground/60">/ 100</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                {helper}
            </div>
        </div>
    );
}

function VerifiedProfileCard() {
    const [idx, setIdx] = useState(0);
    const [paused, setPaused] = useState(false);
    const profile = SAMPLE_PROFILES[idx];

    // Auto-cycle every 6s unless paused
    useEffect(() => {
        if (paused) return;
        const interval = setInterval(() => {
            setIdx((prev) => (prev + 1) % SAMPLE_PROFILES.length);
        }, 6000);
        return () => clearInterval(interval);
    }, [paused]);

    const today = new Date().toISOString().slice(0, 10);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="relative w-full max-w-3xl mx-auto mt-12 mb-16"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            {/* Tiny mono micro-label — system identifier, not content */}
            <div className="flex items-center gap-2 mb-3 font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                <span>Sample profile</span>
                <span className="opacity-60">·</span>
                <span>verified {today}</span>
                <span className="ml-auto opacity-60">{idx + 1} of {SAMPLE_PROFILES.length}</span>
            </div>

            {/* Frame */}
            <div
                className="relative p-7 sm:p-8"
                style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                }}
            >
                <BracketCorners />

                <motion.div
                    key={profile.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                >
                    {/* Identity — name in plain English, sans-serif */}
                    <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                        <h3 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-foreground">
                            {profile.name}
                        </h3>
                        <div className="text-sm text-muted-foreground">
                            {profile.role} <span className="opacity-50 mx-1">·</span> {profile.yrs}
                        </div>
                    </div>
                    <div className="text-sm text-muted-foreground/80 mb-7">
                        {profile.langs.join(' · ')}
                    </div>

                    {/* Dual-axis — plain-English labels with helper text */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
                        <AxisBlock
                            label="Engineering depth"
                            helper="How deep their work goes — measured by code, not commits."
                            score={profile.depth}
                            isPrimary={true}
                        />
                        <AxisBlock
                            label="Reach"
                            helper="How widely their work is used — stars, forks, dependents."
                            score={profile.reach}
                            isPrimary={false}
                        />
                    </div>

                    <div className="h-px bg-border mb-6" />

                    {/* Top achievement — plain English headline */}
                    <div className="mb-1 text-xs text-muted-foreground/80">
                        Top achievement <span className="opacity-60 mx-1">·</span>{' '}
                        <span className="text-primary">{profile.topClaim.tier}</span>
                    </div>
                    <div className="text-base font-medium tracking-tight mb-3 text-foreground">
                        {profile.topClaim.title}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                        Verified by code in:
                    </div>
                    <ul className="space-y-1 mb-6">
                        {profile.topClaim.evidence.map((e) => (
                            <li key={e} className="flex items-baseline gap-2 font-mono text-[12px]">
                                <span className="text-primary">▸</span>
                                <span className="text-foreground/85">{e.split(':')[0]}</span>
                                <span className="text-muted-foreground">line {e.split(':')[1]}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="h-px bg-border mb-5" />

                    {/* Bottom ribbon — plain English */}
                    <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>
                            <span className="font-mono tabular-nums text-foreground/90">{profile.audited}</span> repos audited
                        </span>
                        <span>
                            <span className="font-mono tabular-nums text-foreground/90">{profile.ossPRs}</span> open-source PRs merged
                        </span>
                        <span className="text-primary">✓ Verified by DevProof</span>
                    </div>
                </motion.div>
            </div>

            {/* Profile cycler controls */}
            <div className="flex items-center justify-center gap-3 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                <button
                    onClick={() => setIdx((idx - 1 + SAMPLE_PROFILES.length) % SAMPLE_PROFILES.length)}
                    className="hover:text-foreground transition-colors px-2"
                    aria-label="Previous profile"
                >
                    ←
                </button>
                <div className="flex items-center gap-2">
                    {SAMPLE_PROFILES.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => setIdx(i)}
                            aria-label={`Profile ${i + 1}`}
                            className="w-2 h-2 transition-opacity"
                            style={{
                                background: i === idx ? 'var(--clay)' : 'rgba(255,255,255,0.18)',
                            }}
                        />
                    ))}
                </div>
                <button
                    onClick={() => setIdx((idx + 1) % SAMPLE_PROFILES.length)}
                    className="hover:text-foreground transition-colors px-2"
                    aria-label="Next profile"
                >
                    →
                </button>
                <span className="opacity-50 ml-2">{paused ? 'paused' : 'auto · 6s'}</span>
            </div>
        </motion.div>
    );
}


/* ── Pipeline section — 5 audit stages ── */

const PIPELINE_STAGES = [
    {
        n: '01',
        name: 'Parse',
        line: 'Build an abstract syntax tree of every file in the repo.',
        detail: 'We use cAST chunking to walk every Python, TypeScript, Go, and Rust file. We know what\'s a function, what\'s a route, what\'s a config file — before any AI runs. Static analysis identifies entry points, package boundaries, and ownership.',
    },
    {
        n: '02',
        name: 'Extract',
        line: 'Pull engineering claims from each file using AI, in parallel.',
        detail: 'Each file chunk is sent to a language model with a strict rubric. The model returns a structured claim: what was built, which tier of complexity, which lines of code prove it, and what tradeoffs were made. Output is validated — no malformed JSON, no hallucinated fields.',
    },
    {
        n: '03',
        name: 'Standards',
        line: 'Check engineering rigor — types, tests, errors, security.',
        detail: 'For every claim we record: are there tests covering it? Is the typing strict? How are errors handled (silent, logged, or properly raised)? Are there obvious security concerns? These signals separate craft from quick hacks.',
    },
    {
        n: '04',
        name: 'Verify',
        line: 'Check that every cited line resolves to real code.',
        detail: 'Each evidence span is checked against the actual source tree. No hallucinated file paths. No invented line numbers. If a claim cites code that doesn\'t exist, the claim is dropped.',
    },
    {
        n: '05',
        name: 'Score',
        line: 'Compute two numbers — depth and reach. Never collapsed.',
        detail: 'Engineering depth = weighted aggregate of tier-scored claims (authorship × recency × impact). Reach = log of stars + forks + downstream dependents. The two are kept separate so a high-reach maintainer of a popular link list can\'t look like a deep-systems engineer, and vice versa.',
    },
];

function PipelineSection() {
    const [activeStage, setActiveStage] = useState<number>(0);

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="w-full max-w-4xl mx-auto mb-16"
        >
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-3 text-center">
                How we audit
            </div>

            <h2 className="text-2xl sm:text-3xl font-medium tracking-tight text-center mb-2">
                Every score goes through five stages.
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-10 max-w-xl mx-auto leading-relaxed">
                Hover any stage to see what happens. No black box, no magic.
            </p>

            {/* Stage track */}
            <div className="grid grid-cols-5 gap-0 relative mb-8">
                {/* Connecting line */}
                <div
                    className="absolute top-[7px] left-[8%] right-[8%] h-px"
                    style={{ background: 'rgba(255,255,255,0.10)' }}
                />

                {PIPELINE_STAGES.map((stage, i) => {
                    const isActive = i === activeStage;
                    return (
                        <button
                            key={stage.n}
                            onClick={() => setActiveStage(i)}
                            onMouseEnter={() => setActiveStage(i)}
                            className="relative flex flex-col items-center gap-3 cursor-pointer group"
                        >
                            {/* Node dot — actual circle */}
                            <span
                                className="relative z-10 transition-all"
                                style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    background: isActive ? 'var(--clay)' : '#0A0A0A',
                                    border: `2px solid ${isActive ? 'var(--clay)' : 'rgba(255,255,255,0.30)'}`,
                                    boxShadow: isActive ? '0 0 0 4px rgba(204,120,92,0.15)' : 'none',
                                }}
                            />
                            <div className="text-center px-1">
                                <div
                                    className="font-mono tabular-nums mb-1"
                                    style={{
                                        fontSize: 10,
                                        color: isActive ? 'var(--clay)' : 'rgba(255,255,255,0.40)',
                                        letterSpacing: '0.12em',
                                    }}
                                >
                                    {stage.n}
                                </div>
                                <div
                                    className="transition-colors text-[12px] font-medium"
                                    style={{
                                        color: isActive ? '#EDEDED' : 'rgba(255,255,255,0.55)',
                                    }}
                                >
                                    {stage.name}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Active stage detail */}
            <motion.div
                key={activeStage}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="relative p-6"
                style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                }}
            >
                <BracketCorners />
                <div className="text-xs text-muted-foreground/80 mb-2">
                    Stage {PIPELINE_STAGES[activeStage].n}{' '}
                    <span className="opacity-60 mx-1">·</span>{' '}
                    <span className="text-primary">{PIPELINE_STAGES[activeStage].name}</span>
                </div>
                <div className="text-base font-medium tracking-tight mb-2">
                    {PIPELINE_STAGES[activeStage].line}
                </div>
                <div className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    {PIPELINE_STAGES[activeStage].detail}
                </div>
            </motion.div>
        </motion.div>
    );
}


/* ── Three-column moat strip ── */
function MoatStrip() {
    const items = [
        {
            label: 'SEEN',
            headline: 'We read every line, not just star counts.',
            body: 'Your work gets the attention a senior reviewer would give it.',
        },
        {
            label: 'HONEST',
            headline: 'Caps prevent UI work being sold as systems work.',
            body: 'A polished frontend can\'t masquerade as deep tech. The score reflects what you actually built.',
        },
        {
            label: 'WHOLE',
            headline: 'You\'re more than one number.',
            body: 'Engineering depth and reach scored separately, never collapsed into a single misleading score.',
        },
    ];
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.5 }}
            className="w-full max-w-4xl mx-auto"
        >
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-4 text-center">
                <span>MOAT</span>
                <span className="opacity-60 mx-2">·</span>
                <span>WHY_DEVPROOF</span>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
                {items.map((item) => (
                    <div
                        key={item.label}
                        className="relative p-5"
                        style={{
                            background: 'rgba(255,255,255,0.015)',
                            border: '1px solid rgba(255,255,255,0.05)',
                        }}
                    >
                        <BracketCorners />
                        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-primary mb-2">
                            {item.label}
                        </div>
                        <div className="text-sm font-medium tracking-tight text-foreground mb-1.5">
                            {item.headline}
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed">
                            {item.body}
                        </div>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}


export function HeroSection({ totalIssues: initialTotalIssues }: { totalIssues?: number }) {
    const [totalIssues, setTotalIssues] = useState<number | null>(initialTotalIssues || null);

    useEffect(() => {
        if (initialTotalIssues !== undefined) return;
        getStats().then(s => setTotalIssues(s.total_issues)).catch(() => {});
    }, [initialTotalIssues]);

    return (
        <section className="relative min-h-screen flex flex-col overflow-hidden bg-background">
            {/* Background */}
            <div className="absolute inset-0 z-0">
                <DotPattern
                    width={28}
                    height={28}
                    cr={0.7}
                    className="text-zinc-500/[0.25]"
                />
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col items-center justify-center px-4 pt-24 pb-10 relative z-10">
                {/* Live badge */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border text-sm mb-8"
                >
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500/70 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    <span className="font-mono text-xs">
                        {totalIssues ? <><AnimatedNumber value={totalIssues} /> issues indexed</> : 'Loading...'}
                    </span>
                </motion.div>

                {/* Headline */}
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="text-4xl sm:text-6xl font-bold leading-[1.05] mb-5 tracking-tight text-center max-w-3xl"
                >
                    We don&apos;t score resumes.
                    <br />
                    <span className="bg-gradient-to-r from-[#CC785C] via-[#D4866A] to-[#B5654E] bg-clip-text text-transparent">
                        We score the way you think.
                    </span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-base sm:text-lg text-muted-foreground mb-8 text-center max-w-2xl leading-relaxed"
                >
                    Every commit you&apos;ve ever made carries a decision.
                    We read those decisions and surface them — for you, and for the people hiring.
                </motion.p>

                {/* Verified profile sample — what your DevProof credential looks like */}
                <VerifiedProfileCard />

                {/* Pipeline section — the 5 stages of how we audit */}
                <PipelineSection />

                {/* Three-column moat strip */}
                <MoatStrip />
            </div>
        </section>
    );
}
