import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/* Every page is rendered per request for the signed-in user, so no incremental cache is needed. */
export default defineCloudflareConfig({});
