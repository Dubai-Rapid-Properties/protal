/** Choices the unit "Website" form offers; ids match the website's amenity list. */
export const WEBSITE_TYPES = ["studio", "apartment", "penthouse", "villa", "townhouse"] as const;

export const WEBSITE_AREAS = [
  "Palm Jumeirah",
  "Dubai Marina",
  "JVT",
  "Business Bay",
  "DIFC",
  "JVC",
  "Dubai Sports City",
  "Meydan",
  "Downtown Dubai",
] as const;

export const WEBSITE_AMENITIES: Record<string, string> = {
  pool: "Private pool", sharedPool: "Shared pool", seaView: "Sea view", marinaView: "Marina view",
  skylineView: "Skyline / Burj view", canalView: "Canal view", garden: "Private garden", parking: "Free parking",
  gym: "Shared gym", beachAccess: "Beach access", wifi: "Fast Wi-Fi", washer: "Washer & dryer",
  workspace: "Dedicated workspace", petsAllowed: "Pets allowed", concierge: "Concierge on call",
  carFleet: "DRP car fleet", housekeeping: "Housekeeping included", security: "24/7 security",
  elevator: "Direct elevator access", smartHome: "Smart home controls", furnished: "Designer furnished",
  airCon: "Air conditioning", kitchen: "Fully equipped kitchen", sauna: "Sauna", steamRoom: "Steam room",
  bbq: "BBQ area", smartLock: "Smart-lock self check-in", mallAccess: "Direct mall access",
  basketball: "Basketball court",
};

/** "Name | 2026-12-20 | 2027-01-05 | 1800" per line → season rows; bad lines are reported, not dropped. */
export function parseSeasons(text: string): { seasons: { name: string; from: string; to: string; rate: number }[]; error?: string } {
  const seasons: { name: string; from: string; to: string; rate: number }[] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [name, from, to, rate] = line.split("|").map((s) => s.trim());
    const ok = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !ok.test(from) || !ok.test(to) || !(Number(rate) > 0) || to < from) {
      return { seasons: [], error: `Season line ${i + 1}: use "Name | 2026-12-20 | 2027-01-05 | 1800".` };
    }
    seasons.push({ name: name ?? "", from, to, rate: Number(rate) });
  }
  return { seasons };
}

export const seasonsToText = (rows: unknown): string =>
  Array.isArray(rows)
    ? rows
        .map((r: { name?: string; from?: string; to?: string; rate?: number }) =>
          [r.name ?? "", r.from, r.to, r.rate].join(" | "))
        .join("\n")
    : "";

export type BedRow = { room: string; beds: string };

/** "Bedroom 1 | 1 king bed" per line → rows for the website's "Where you'll sleep"; bad lines are reported. */
export function parseBeds(text: string): { beds: BedRow[]; error?: string } {
  const beds: BedRow[] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [room, what, ...rest] = line.split("|").map((s) => s.trim());
    if (!room || !what || rest.length || room.length > 60 || what.length > 80) {
      return { beds: [], error: `Sleeping line ${i + 1}: use "Bedroom 1 | 1 king bed".` };
    }
    beds.push({ room, beds: what });
  }
  if (beds.length > 12) return { beds: [], error: "Sleeping arrangements: at most 12 rooms." };
  return { beds };
}

export const bedsToText = (rows: unknown): string =>
  Array.isArray(rows)
    ? rows
        .filter((r): r is BedRow => !!r && typeof r === "object" && typeof r.room === "string" && typeof r.beds === "string")
        .map((r) => `${r.room} | ${r.beds}`)
        .join("\n")
    : "";
