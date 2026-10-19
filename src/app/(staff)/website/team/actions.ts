"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { slugify } from "@/lib/listings";
import { rebuildWebsite } from "@/lib/website";

export type TeamState = { error?: string };

const NOT_ALLOWED = "You do not have permission to edit the website team.";

async function requireEditor() {
  const profile = await requireProfile();
  return can(profile.role, "website.manage") ? profile : null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

/** A number the website can dial: digits, spaces and an optional leading +. */
const phone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || /^\+?[\d\s()-]{7,}$/.test(v), "Enter phone numbers like +971 50 123 4567");

const memberSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(120),
  role: z.string().trim().max(120).default(""),
  summary: optionalText(200),
  bio: z.string().max(10000).optional(),
  photoUrl: optionalText(500),
  brn: optionalText(20),
  phone,
  whatsapp: phone,
  email: optionalText(200).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
  agentNames: z.string().max(500).optional(),
  showOnAbout: z.literal("on").optional(),
  isActive: z.literal("on").optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000),
});

/** Creates (id null) or updates a team member; the website rebuilds to show it. */
export async function saveTeamMember(id: string | null, _prev: TeamState, formData: FormData): Promise<TeamState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  if (id !== null && !z.string().uuid().safeParse(id).success) return { error: "Team member not found." };

  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const slug = slugify(v.name);
  if (!slug) return { error: "The name needs letters." };

  const row = {
    slug,
    name: v.name,
    role: v.role,
    summary: v.summary,
    bio: (v.bio ?? "").replace(/\r\n/g, "\n").trim(),
    photo_url: v.photoUrl,
    brn: v.brn,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email,
    agent_names: (v.agentNames ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    show_on_about: v.showOnAbout === "on",
    is_active: v.isActive === "on",
    sort_order: v.sortOrder,
    updated_by: profile.id,
  };

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("website_team").update(row).eq("id", id).select("id")
    : await supabase.from("website_team").insert({ ...row, created_by: profile.id }).select("id");
  if (error) {
    if (error.code === "23505") return { error: "Someone with this name is already on the team." };
    return { error: error.message };
  }
  if (!data?.length) return { error: NOT_ALLOWED };

  const rebuild = await rebuildWebsite();
  revalidatePath("/website/team");
  revalidatePath("/website/listings");
  redirect(`/website/team?saved=${rebuild.started ? "live" : "pending"}`);
}

export async function deleteTeamMember(id: string): Promise<TeamState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(id).success) return { error: "Team member not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("website_team").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "This team member could not be deleted." };
  await rebuildWebsite();
  revalidatePath("/website/team");
  redirect("/website/team?saved=deleted");
}
