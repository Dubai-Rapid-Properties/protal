/**
 * Single place where configuration enters the application.
 *
 * Nothing else in the codebase reads process.env directly (outside of the two
 * NEXT_PUBLIC_ values the browser bundle needs inlined). Keeping it here is
 * what makes moving from Vercel + Supabase to AWS Amplify + RDS/Cognito a
 * configuration change rather than a refactor.
 */

const optional = (key: string): string | undefined => {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
};

export const env = {
  // `||` rather than `??`: a CI build sets unused variables to "" (GitHub
  // Actions turns an unset variable into an empty string).
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  // Supabase renamed its keys: new projects issue `sb_publishable_...` /
  // `sb_secret_...`, older ones the JWT-style anon / service_role pair. Both
  // names are accepted so a project of either vintage works untouched.
  // These must stay as literal process.env references - that is what lets
  // Next.js inline them into the browser bundle.
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "",
  supabaseServiceRoleKey:
    optional("SUPABASE_SECRET_KEY") ?? optional("SUPABASE_SERVICE_ROLE_KEY"),

  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  appName: process.env.NEXT_PUBLIC_APP_NAME || "D|R|P Property Management",

  // Canonical origins of the two portals. Used wherever the app has to build
  // an absolute link: invite emails, password resets, the iCal export URL.
  adminUrl: optional("ADMIN_URL") ?? "http://admin.localhost:3000",
  ownerUrl: optional("OWNER_URL") ?? "http://owner.localhost:3000",
  // Portal served on a host with no admin./owner. prefix (preview deployments,
  // bare localhost). Unset in production so unknown hosts serve nothing.
  // `next dev` defaults to the back office so http://localhost:3000 works.
  portalFallback:
    optional("PORTAL_FALLBACK") ??
    (process.env.NODE_ENV === "development" ? "admin" : undefined),

  // Owner passwords. Off (default): a sign-in link logs the owner straight
  // into the portal. On: owners choose a password from the link and must have
  // one to use the portal. On: OWNER_PASSWORDS=on in wrangler.jsonc.
  ownerPasswords: optional("OWNER_PASSWORDS") === "on",

  // How long an owner's sign-in link works, in hours (the portal's own link,
  // 0050; until then it can be opened any number of times). Invites and the
  // owner page say this many.
  ownerLinkValidHours: Number(optional("OWNER_LINK_VALID_HOURS") ?? 168),

  // Shared secret for the scheduled endpoints (/api/cron/*). The scheduler
  // (Supabase pg_cron) sends it as "Authorization: Bearer <secret>".
  cronSecret: optional("CRON_SECRET"),

  // The admin team's bookings sheet (a Google Sheets link or ID, shared as
  // "anyone with the link can view"). The calendar cron brings its direct
  // and old-Airbnb-account stays into the portal (src/lib/sheet/sync.ts).
  // Unset: no sheet sync.
  bookingsSheet: optional("BOOKINGS_SHEET"),

  // Shared secret the Holiday Homes website sends ("Authorization: Bearer ...")
  // to create and update bookings through /api/public/bookings. Without it
  // those endpoints refuse every request; the read-only ones stay public.
  websiteApiKey: optional("WEBSITE_API_KEY"),

  // The D|R|P website builds its Buy / Rent pages from /api/public/listings.
  // How to start a website rebuild: a deploy hook URL (Vercel, Cloudflare
  // Workers Builds), or the website repo's GitHub dispatch URL
  // (https://api.github.com/repos/<owner>/<repo>/dispatches) together with
  // WEBSITE_DEPLOY_GITHUB_TOKEN. When set, saving a listing that is (or was)
  // on the website starts a rebuild, so the change goes live in a few
  // minutes. Unset: the website updates on its next deploy.
  websiteDeployHookUrl: optional("WEBSITE_DEPLOY_HOOK_URL"),
  // Fine-grained GitHub token for the website repo only (Contents: read and
  // write), needed when WEBSITE_DEPLOY_HOOK_URL is a GitHub dispatch URL.
  websiteDeployGithubToken: optional("WEBSITE_DEPLOY_GITHUB_TOKEN"),
  // Where the website is served, for "View on the website" links.
  websiteUrl: (optional("WEBSITE_URL") ?? "https://dubairapidproperties.com").replace(/\/$/, ""),
  // The Holiday Homes website, which the portal tells when staff accept or decline a booking made
  // there (it takes or releases the guest's card hold). Called with WEBSITE_API_KEY.
  holidayHomesUrl: (optional("HOLIDAY_HOMES_URL") ?? "https://stay.dubairapidproperties.com").replace(/\/$/, ""),

  storage: {
    driver: (optional("STORAGE_DRIVER") ?? "supabase") as "supabase" | "s3",
    documentsBucket: optional("STORAGE_BUCKET_DOCUMENTS") ?? "documents",
    mediaBucket: optional("STORAGE_BUCKET_MEDIA") ?? "media",
  },

  payments: {
    provider: (optional("PAYMENT_PROVIDER") ?? "none") as
      | "none"
      | "ziina"
      | "telr"
      | "network"
      | "stripe",
    apiKey: optional("PAYMENT_API_KEY"),
    webhookSecret: optional("PAYMENT_WEBHOOK_SECRET"),
  },

  messaging: {
    whatsappProvider: (optional("WHATSAPP_PROVIDER") ?? "none") as "none" | "meta",
    whatsappPhoneNumberId: optional("WHATSAPP_PHONE_NUMBER_ID"),
    whatsappAccessToken: optional("WHATSAPP_ACCESS_TOKEN"),
    emailProvider: (optional("EMAIL_PROVIDER") ?? "none") as "none" | "resend",
    resendApiKey: optional("RESEND_API_KEY"),
    emailFrom: optional("EMAIL_FROM") ?? "noreply@example.ae",
    smsProvider: (optional("SMS_PROVIDER") ?? "none") as "none" | "generic",
    smsApiKey: optional("SMS_API_KEY"),
  },
} as const;

/** True once Supabase credentials are present. Drives the /setup screen. */
export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
