import type { Tables } from "@/lib/db/database.types";

export type TeamRow = Tables<"website_team">;

/** One team member, in the shape the D|R|P website reads (/api/public/team). */
export type WebsiteTeamMember = {
  slug: string;
  name: string;
  role: string;
  line: string | null;
  bio: string[];
  photo: string | null;
  brn: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  agentNames: string[];
  showOnAbout: boolean;
  order: number;
};

export function toWebsiteTeamMember(row: TeamRow): WebsiteTeamMember {
  return {
    slug: row.slug,
    name: row.name,
    role: row.role,
    line: row.summary || null,
    bio: row.bio
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
    photo: row.photo_url || null,
    brn: row.brn || null,
    phone: row.phone || null,
    whatsapp: row.whatsapp || null,
    email: row.email || null,
    agentNames: row.agent_names ?? [],
    showOnAbout: row.show_on_about,
    order: row.sort_order,
  };
}

/** A photo kept on the website itself ("/media/…") shown from the portal. */
export function teamPhotoSrc(photo: string | null, websiteUrl: string): string | null {
  if (!photo) return null;
  return photo.startsWith("/") ? `${websiteUrl}${photo}` : photo;
}
