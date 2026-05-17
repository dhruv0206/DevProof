import { betterAuth } from "better-auth";
import { pool } from "@/lib/db";

// Use shared pool instance


export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || "https://orenda.vision",
  trustedOrigins: [
    "https://orenda.vision",
    "https://dev-proof-portfolio.vercel.app",
    "http://localhost:3000",
  ],
  emailAndPassword: {
    // Used ONLY for platform-owner admins (created via scripts/create_admin.py).
    // No sign-up endpoint is exposed — admins are CLI-provisioned, never self-serve.
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      // Default scopes — enough to read public profile + email + public repos.
      // Private-repo access is upgraded explicitly via /settings/github
      // (the "Grant private repo access" flow re-runs OAuth with repo scope
      // so existing users aren't surprise-promoted to a broader grant).
      scope: ["read:user", "user:email"],
      // Map GitHub profile to user fields
      mapProfileToUser: (profile) => {
        return {
          name: profile.login, // GitHub username
          email: profile.email,
          image: profile.avatar_url,
        };
      },
    },
  },
  session: {
    // 60 days. Hackathon organizers/judges are infrequent users — most
    // sign in once during onboarding and don't return until weeks later.
    // The self-serve `/hackathons/sign-in` page handles longer absences;
    // the 60-day window covers everything in between without forcing
    // them to re-auth mid-event. `updateAge` keeps active sessions
    // sliding so the clock effectively resets every day they log in.
    expiresIn: 60 * 60 * 24 * 60,
    updateAge: 60 * 60 * 24,
  },
  account: {
    accountLinking: {
      // DISABLED ON PURPOSE — blocks the skeleton-user pre-takeover
      // attack at the auth-library level.
      //
      // Threat: organizer onboarding pre-creates `emailVerified=FALSE`
      // user rows (so non-developers can accept magic links without a
      // GitHub account — see create_organizer.py / platform_reissue_invite).
      // BetterAuth's DEFAULT behavior auto-links a new OAuth identity
      // to any existing user row matching email, as long as the
      // INCOMING OAuth provider's email is verified — it does NOT
      // check the EXISTING row's `emailVerified` state. (Verified from
      // BetterAuth source: `oauth2/link-account.mjs:21`.)
      //
      // Auto-link would mean: an operator-created skeleton for
      // `victim@example.com` gets the victim's future GitHub OAuth
      // silently merged into it, attaching their identity to whatever
      // hackathon_role the operator pre-assigned. Worse, if the
      // operator pre-clicked the magic link to mint themselves a 60-day
      // session bound to that user.id, the victim's GitHub OAuth would
      // attach to a row the operator already controls — full takeover.
      //
      // With linking disabled: the magic-link POST is the ONLY path
      // that mints a session for a magic-link-invited user, and it
      // atomically sets emailVerified=TRUE inside the same transaction
      // that grants the role and mints the cookie. A separate GitHub
      // OAuth sign-in with the same email after that point will hit
      // BetterAuth's "account already exists" path and can be handled
      // by an explicit "Link GitHub" flow from /settings (manual
      // linking, not auto-merge).
      //
      // UX cost: a magic-link-invited user (organizer) who later wants
      // to also use DevProof as a developer must manually link their
      // GitHub identity from settings instead of just signing in with
      // GitHub and seeing the accounts auto-merge. Acceptable tradeoff
      // for closing the takeover path.
      enabled: false,
    },
  },
  // Use databaseHooks for reliable first-login profile population
  databaseHooks: {
    user: {
      create: {
        // After user is created, populate GitHub profile
        after: async (user) => {
          // Give a small delay for the account to be created
          setTimeout(async () => {
            try {
              // Get the access token from the account table
              const accountResult = await pool.query(
                'SELECT "accessToken" FROM account WHERE "userId" = $1 AND "providerId" = $2',
                [user.id, "github"]
              );
              
              const accessToken = accountResult.rows[0]?.accessToken;
              
              if (accessToken) {
                const response = await fetch("https://api.github.com/user", {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "DevProof",
                  },
                });
                
                if (response.ok) {
                  const profile = await response.json();
                  
                  // Update user with GitHub profile data
                  await pool.query(
                    `UPDATE "user" SET
                      "githubUsername" = $1,
                      "githubId" = $2,
                      "company" = $3,
                      "blog" = $4,
                      "location" = $5,
                      "bio" = $6,
                      "twitterUsername" = $7,
                      "publicRepos" = $8,
                      "followers" = $9,
                      "following" = $10,
                      "githubCreatedAt" = $11,
                      "hireable" = $12
                    WHERE id = $13`,
                    [
                      profile.login,
                      profile.id,
                      profile.company,
                      profile.blog,
                      profile.location,
                      profile.bio,
                      profile.twitter_username,
                      profile.public_repos,
                      profile.followers,
                      profile.following,
                      profile.created_at ? new Date(profile.created_at) : null,
                      profile.hireable,
                      user.id,
                    ]
                  );
                  
                  console.log(`[Auth] GitHub profile saved for user ${profile.login}`);
                } else {
                  console.error(`[Auth] GitHub API error: ${response.status}`);
                }
              } else {
                console.log(`[Auth] No access token found for user ${user.id}`);
              }
            } catch (error) {
              console.error("[Auth] Failed to fetch GitHub profile:", error);
            }
          }, 500); // Small delay to ensure account record exists
        },
      },
    },
  },
});

