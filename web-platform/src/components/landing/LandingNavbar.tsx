'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useSession, signIn } from '@/lib/auth-client';
import { Loader2, Menu, X, Star } from 'lucide-react';

export function LandingNavbar() {
    const [scrolled, setScrolled] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const { data: session, isPending } = useSession();
    const [isSigningIn, setIsSigningIn] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const handleSignIn = async () => {
        setIsSigningIn(true);
        try {
            await signIn.social({ provider: 'github', callbackURL: '/dashboard' });
        } catch (error) {
            setIsSigningIn(false);
        }
    };

    const navItems = [
        { name: 'How It Works', href: '#how-it-works' },
        { name: 'Features', href: '#features' },
        { name: 'Recent Scores', href: '#recent-scores' },
        { name: 'Hackathons', href: '/hackathons' },
    ];

    return (
        <>
            <motion.header
                initial={{ y: -100 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.5 }}
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
                    ? 'bg-background border-b border-border shadow-sm'
                    : 'bg-transparent'
                    }`}
            >
                <div className="container mx-auto px-4">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <a href="/" className="flex items-center gap-2 group">
                            <motion.div
                                className="flex items-center text-xl font-bold"
                                whileHover={{ scale: 1.02 }}
                            >
                                <span className="text-muted-foreground group-hover:text-primary transition-colors">&lt;</span>
                                <img src="/logo_transparent.png" alt="DevProof" className="w-8 h-8 mx-1" />
                                <span>DevProof</span>
                                <span className="text-muted-foreground group-hover:text-primary transition-colors">/&gt;</span>
                            </motion.div>
                        </a>

                        {/* Navigation */}
                        <nav className="hidden md:flex items-center gap-6">
                            {navItems.map((item) => (
                                <a
                                    key={item.name}
                                    href={item.href}
                                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {item.name}
                                </a>
                            ))}
                        </nav>

                        {/* Actions */}
                        <div className="flex items-center gap-2 md:gap-3">
                            {/* GitHub Star - Hidden on very small screens */}
                            <a
                                href="https://github.com/dhruv0206/opensource-issues-finder"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hidden sm:block"
                            >
                                <Button variant="outline" size="sm" className="gap-1.5 h-8 md:h-9">
                                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                                    <span className="hidden lg:inline">Star on GitHub</span>
                                    <span className="lg:hidden">Star</span>
                                </Button>
                            </a>

                            <ThemeToggle />

                            {/* Auth - Minimal on mobile */}
                            {isPending ? (
                                <div className="w-20 md:w-24 h-8 md:h-9 rounded-md bg-muted animate-pulse" />
                            ) : session ? (
                                <Button variant="default" size="sm" className="h-8 md:h-9" asChild>
                                    <a href="/dashboard">Dashboard</a>
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground border-0 h-8 md:h-9"
                                    onClick={handleSignIn}
                                    disabled={isSigningIn}
                                >
                                    {isSigningIn ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <>
                                            <span className="hidden sm:inline">Sign In</span>
                                            <span className="sm:hidden text-xs">Login</span>
                                        </>
                                    )}
                                </Button>
                            )}

                            {/* Mobile Menu Toggle */}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="md:hidden p-1 px-1.5"
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                            >
                                {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Mobile Menu Overlay */}
                <AnimatePresence>
                    {isMenuOpen && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3 }}
                            className="md:hidden border-b border-border bg-background overflow-hidden"
                        >
                            <nav className="flex flex-col p-4 gap-4">
                                {navItems.map((item) => (
                                    <a
                                        key={item.name}
                                        href={item.href}
                                        onClick={() => setIsMenuOpen(false)}
                                        className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                                    >
                                        {item.name}
                                    </a>
                                ))}
                                <div className="pt-2 border-t border-border flex flex-col gap-3">
                                    <a
                                        href="https://github.com/dhruv0206/opensource-issues-finder"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
                                    >
                                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                        Star on GitHub
                                    </a>
                                </div>
                            </nav>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.header>
        </>
    );
}
