import { Metadata } from 'next';
import { ProfileLayout } from '@/components/profile/ProfileLayout';
import { ProfileContent } from '@/components/profile/ProfileContent';
import { PinnedHackathonsCard } from '@/components/hackathons/PinnedHackathonsCard';

interface PageProps {
    params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { username } = await params;

    const ogImageUrl = `https://orenda.vision/api/og/${username}`;

    return {
        title: `${username} | DevProof`,
        description: `View ${username}'s verified open source contributions on DevProof.`,
        openGraph: {
            title: `${username}'s Developer Portfolio`,
            description: `Check out ${username}'s verified open source contributions.`,
            type: 'profile',
            images: [
                {
                    url: ogImageUrl,
                    width: 1200,
                    height: 630,
                    alt: `${username}'s DevProof Portfolio`,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title: `${username}'s Developer Portfolio | DevProof`,
            description: `Check out ${username}'s verified open source contributions.`,
            images: [ogImageUrl],
        },
    };
}

export default async function PublicProfilePage({ params }: PageProps) {
    const { username } = await params;

    return (
        <ProfileLayout>
            <ProfileContent username={username} />
            <PinnedHackathonsCard username={username} />
        </ProfileLayout>
    );
}
