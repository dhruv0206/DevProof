import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
    LayoutDashboard,
    Search,
    UserCircle,
    Settings,
    LogOut,
    Github,
    ClipboardList,
    PanelLeftClose,
    PanelLeftOpen,
    Menu,
    Code,
    Linkedin,
    ShieldCheck,
    Trophy,
} from 'lucide-react';
import { useSession, signIn, signOut } from '@/lib/auth-client';
import { useSidebar } from '@/components/layout/SidebarContext';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

const menuItems = [
    {
        name: 'Dashboard',
        icon: LayoutDashboard,
        href: '/dashboard',
    },
    {
        name: 'My Issues',
        icon: ClipboardList,
        href: '/issues',
    },
    {
        name: 'Open Source Finder',
        icon: Search,
        href: '/finder',
    },
    {
        name: 'Projects',
        icon: Code,
        href: '/projects',
    },
    {
        name: 'Hackathons',
        icon: Trophy,
        href: '/hackathons',
    },
    {
        name: 'Profile',
        icon: UserCircle,
        href: '/profile',
    },
    {
        name: 'GitHub Access',
        icon: ShieldCheck,
        href: '/settings/github',
    },
    {
        name: 'Settings',
        icon: Settings,
        href: '/settings',
    },
];

export function DashboardSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session } = useSession();
    const { state, isMobile, openMobile, setOpenMobile, toggleSidebar } = useSidebar();

    const handleSignOut = async () => {
        await signOut();
        router.push('/');
    };

    const handleSignIn = () => {
        signIn.social({ provider: 'github' });
    };

    if (isMobile) {
        return (
            <>
                {/* Mobile Header Toggle is handled in Layout, but we render the Drawer here or in Layout. 
                    Actually, let's keep the Sidebar responsible for its own rendering including mobile drawer.
                */}
                {openMobile && (
                    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setOpenMobile(false)} />
                )}
                <div
                    className={cn(
                        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transition-transform transform duration-300 ease-in-out",
                        openMobile ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    <div className="h-full flex flex-col">
                        <div className="p-6 border-b border-border flex justify-between items-center">
                            <Link href="/" className="flex items-center gap-2.5 font-bold text-xl tracking-tight" onClick={() => setOpenMobile(false)}>
                                <img src="/logo_transparent.png" alt="DevProof" className="h-9 w-9 object-contain" />
                                <span className="font-mono text-base">
                                    <span className="text-muted-foreground">&lt;</span>
                                    <span>devproof</span>
                                    <span className="text-primary">/</span>
                                    <span className="text-muted-foreground">&gt;</span>
                                </span>
                            </Link>
                            <Button variant="ghost" size="icon" onClick={() => setOpenMobile(false)}>
                                <PanelLeftClose className="h-5 w-5" />
                            </Button>
                        </div>
                        <SidebarContent
                            menuItems={menuItems}
                            pathname={pathname}
                            session={session}
                            handleSignIn={handleSignIn}
                            handleSignOut={handleSignOut}
                            onItemClick={() => setOpenMobile(false)}
                        />
                    </div>
                </div>
            </>
        );
    }

    // Desktop
    return (
        <div
            className={cn(
                "h-screen border-r border-border bg-card flex flex-col fixed left-0 top-0 transition-all duration-300",
                state === 'collapsed' ? "w-16" : "w-64"
            )}
        >
            <div className={cn("p-4 border-b border-border flex items-center h-16", state === 'collapsed' ? "justify-center" : "justify-between")}>
                {state !== 'collapsed' && (
                    <Link href="/" className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                        <img src="/logo_transparent.png" alt="DevProof" className="h-7 w-7 object-contain" />
                        <span className="font-mono text-sm font-semibold tracking-tight">
                            <span className="text-muted-foreground">&lt;</span>
                            <span>devproof</span>
                            <span className="text-primary">/</span>
                            <span className="text-muted-foreground">&gt;</span>
                        </span>
                    </Link>
                )}

                {/* Desktop Toggle - Consistent Location */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                    {state === 'collapsed' ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>
            </div>

            {/* Content */}
            <SidebarContent
                menuItems={menuItems}
                pathname={pathname}
                session={session}
                handleSignIn={handleSignIn}
                handleSignOut={handleSignOut}
                collapsed={state === 'collapsed'}
            />
        </div>
    );
}

function SidebarContent({
    menuItems, pathname, session, handleSignIn, handleSignOut, collapsed = false, onItemClick
}: {
    menuItems: any[], pathname: string, session: any, handleSignIn: () => void, handleSignOut: () => void, collapsed?: boolean, onItemClick?: () => void
}) {
    return (
        <div className="flex-1 flex flex-col min-h-0">
            <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
                <TooltipProvider delayDuration={0}>
                    {menuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || (item.href === '/finder' && pathname === '/');

                        if (collapsed) {
                            return (
                                <Tooltip key={item.href}>
                                    <TooltipTrigger asChild>
                                        <Link href={item.href}>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn("w-full h-10", isActive && 'bg-primary/10 text-primary')}
                                            >
                                                <Icon className="h-5 w-5" />
                                                <span className="sr-only">{item.name}</span>
                                            </Button>
                                        </Link>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        {item.name}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        }

                        return (
                            <Link key={item.href} href={item.href} onClick={onItemClick}>
                                <Button
                                    variant="ghost"
                                    className={cn("w-full justify-start gap-3 text-sm tracking-tight font-medium", isActive && 'bg-primary/10 text-primary')}
                                >
                                    <Icon className="h-5 w-5" />
                                    {item.name}
                                </Button>
                            </Link>
                        );
                    })}
                </TooltipProvider>
            </nav>

            <div className="p-4 border-t border-border space-y-1">
                {session ? (
                    collapsed ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        onClick={handleSignOut}
                                    >
                                        <LogOut className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right">Sign Out</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <Button
                            variant="ghost"
                            className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={handleSignOut}
                        >
                            <LogOut className="h-5 w-5" />
                            Sign Out
                        </Button>
                    )
                ) : (
                    collapsed ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="w-full text-primary hover:text-primary hover:bg-primary/10"
                                        onClick={handleSignIn}
                                    >
                                        <Github className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right">Sign in with GitHub</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <Button
                            variant="ghost"
                            className="w-full justify-start gap-3 text-primary hover:text-primary hover:bg-primary/10"
                            onClick={handleSignIn}
                        >
                            <Github className="h-5 w-5" />
                            Sign in with GitHub
                        </Button>
                    )
                )}

                {/* LinkedIn */}
                {collapsed ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <a href="https://www.linkedin.com/in/dhruv-patel-0206/" target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" className="w-full text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10">
                                        <Linkedin className="h-5 w-5" />
                                    </Button>
                                </a>
                            </TooltipTrigger>
                            <TooltipContent side="right">Connect on LinkedIn</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <a href="https://www.linkedin.com/in/dhruv-patel-0206/" target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10">
                            <Linkedin className="h-5 w-5" />
                            Connect on LinkedIn
                        </Button>
                    </a>
                )}
            </div>
        </div>
    );
}
