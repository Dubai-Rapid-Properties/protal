"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { fromWebsiteListing } from "@/lib/listings";
import { env } from "@/lib/env";
import { rebuildWebsite } from "@/lib/website";

/** The website's Property Finder listings, as it publishes them. */
export async function fetchPropertyFinderListings(): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${env.websiteUrl}/pf-listings.json`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/**
 * Takes a Property Finder listing over: copies it into website_listings under
 * the same web address, so the website shows this copy instead of Property
 * Finder's. "edit" keeps it on the website to change in the form; "hide"
 * takes it off the website. Property Finder itself is never touched, and a
 * taken-over listing no longer follows its changes there.
 */
export async function takeOver(formData: FormData) {
  const profile = await requireProfile();
  if (!can(profile.role, "website.manage")) redirect("/website/listings/property-finder?error=permission");
  const slug = String(formData.get("slug") ?? "");
  const mode = formData.get("mode") === "hide" ? "hide" : "edit";

  const supabase = await createClient();
  const { data: existing } = await supabase.from("website_listings").select("id, status").eq("slug", slug).maybeSingle();
  if (existing) {
    // Deleted from the website: only Restore brings it back.
    if (existing.status === "removed") redirect("/website/listings/property-finder");
    if (mode === "hide" && existing.status !== "hidden") {
      await supabase.from("website_listings").update({ status: "hidden", updated_by: profile.id }).eq("id", existing.id);
      await rebuildWebsite();
      revalidatePath("/website/listings");
      redirect("/website/listings?saved=live");
    }
    redirect(`/website/listings/${existing.id}`);
  }

  const list = await fetchPropertyFinderListings();
  if (!list) redirect("/website/listings/property-finder?error=website");
  const source = list.find((l) => (l as { slug?: unknown })?.slug === slug);
  const row = fromWebsiteListing(source);
  if (!row) redirect("/website/listings/property-finder?error=listing");

  const { data, error } = await supabase
    .from("website_listings")
    .insert({ ...row, status: mode === "hide" ? "hidden" : "published", created_by: profile.id, updated_by: profile.id })
    .select("id")
    .single();
  if (error) redirect(`/website/listings/property-finder?error=${encodeURIComponent(error.message.slice(0, 120))}`);

  revalidatePath("/website/listings");
  if (mode === "hide") {
    await rebuildWebsite();
    redirect("/website/listings?saved=live");
  }
  redirect(`/website/listings/${data.id}`);
}

/** Undoes deleting a Property Finder listing: it shows on the website again, as on Property Finder. */
export async function restoreListing(formData: FormData) {
  const profile = await requireProfile();
  if (!can(profile.role, "website.manage")) redirect("/website/listings/property-finder?error=permission");
  const slug = String(formData.get("slug") ?? "");

  const supabase = await createClient();
  await supabase.from("website_listings").delete().eq("slug", slug).eq("status", "removed");
  await rebuildWebsite();
  revalidatePath("/website/listings/property-finder");
  redirect("/website/listings?saved=live");
}
