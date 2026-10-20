import { env } from "@/lib/env";

export type RebuildResult = { started: boolean; reason?: string };

/** The website repo's GitHub dispatch endpoint, e.g. https://api.github.com/repos/owner/repo/dispatches */
const GITHUB_DISPATCH = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/dispatches$/;

/**
 * Asks for a rebuild of the D|R|P website (WEBSITE_DEPLOY_HOOK_URL), which
 * pulls the published listings from /api/public/listings as it builds:
 * either a deploy hook (Vercel, Cloudflare), or a GitHub repository_dispatch
 * "rebuild" that the website's Cloudflare deploy workflow listens for.
 * Never throws: a listing is saved whether or not the rebuild starts.
 */
export async function rebuildWebsite(): Promise<RebuildResult> {
  const hook = env.websiteDeployHookUrl;
  if (!hook) return { started: false, reason: "not_configured" };

  const github = GITHUB_DISPATCH.test(hook);
  if (github && !env.websiteDeployGithubToken) return { started: false, reason: "not_configured" };

  try {
    const response = await fetch(hook, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      ...(github
        ? {
            headers: {
              Authorization: `Bearer ${env.websiteDeployGithubToken}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
              // GitHub refuses requests without one (403), and a Worker's fetch sends none
              "User-Agent": "drp-portal",
            },
            body: JSON.stringify({ event_type: "rebuild" }),
          }
        : {}),
    });
    if (!response.ok) {
      console.error(`[website] deploy hook answered HTTP ${response.status}`);
      return { started: false, reason: `HTTP ${response.status}` };
    }
    return { started: true };
  } catch (error) {
    console.error(`[website] deploy hook failed: ${error instanceof Error ? error.message : error}`);
    return { started: false, reason: "unreachable" };
  }
}
