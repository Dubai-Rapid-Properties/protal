import { test } from "node:test";
import assert from "node:assert/strict";
import { teamPhotoSrc, toWebsiteTeamMember, type TeamRow } from "@/lib/website-team";

const row: TeamRow = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "tara-topic",
  name: "Tara Topic",
  role: "Managing Director",
  summary: "",
  bio: "First paragraph.\r\n\r\nSecond paragraph.\n\n\n",
  photo_url: "/media/2024/02/Ms-Tara_-scaled.webp",
  brn: "77282",
  phone: "",
  whatsapp: "+971 56 777 0272",
  email: null,
  agent_names: ["Tara T."],
  show_on_about: true,
  sort_order: 20,
  is_active: true,
  created_by: null,
  updated_by: null,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
};

test("a team row becomes the website's team member", () => {
  const m = toWebsiteTeamMember(row);
  assert.deepEqual(m.bio, ["First paragraph.", "Second paragraph."]);
  assert.equal(m.line, null);
  assert.equal(m.phone, null);
  assert.equal(m.whatsapp, "+971 56 777 0272");
  assert.equal(m.brn, "77282");
  assert.deepEqual(m.agentNames, ["Tara T."]);
  assert.equal(m.showOnAbout, true);
  assert.equal(m.order, 20);
});

test("photos kept on the website show from the portal through its address", () => {
  assert.equal(teamPhotoSrc("/media/a.jpg", "https://new-drp.vercel.app"), "https://new-drp.vercel.app/media/a.jpg");
  assert.equal(teamPhotoSrc("https://x.supabase.co/a.jpg", "https://new-drp.vercel.app"), "https://x.supabase.co/a.jpg");
  assert.equal(teamPhotoSrc(null, "https://new-drp.vercel.app"), null);
});
