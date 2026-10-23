import { createAdminClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";

/**
 * Short-lived links to a ticket's photos. Call only with paths from a ticket
 * the signed-in person has just read (row security decided that): owners
 * cannot sign files in the private bucket themselves, so the server does.
 */
export async function ticketPhotoUrls(paths: string[] | null): Promise<{ path: string; url: string | null }[]> {
  if (!paths?.length) return [];
  const admin = createAdminClient();
  return Promise.all(
    paths.map(async (path) => {
      const { data } = await admin.storage.from(BUCKETS.documents).createSignedUrl(path, 3600);
      return { path, url: data?.signedUrl ?? null };
    })
  );
}
