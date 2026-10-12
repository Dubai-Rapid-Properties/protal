import { test } from "node:test";
import assert from "node:assert/strict";
import { humanise, leadFromWebsite } from "@/lib/leads";

test("a contact form becomes a new website lead", () => {
  const lead = leadFromWebsite({
    form: "contact",
    name: " Amal Perera ",
    email: "amal@example.com",
    phone: "+971500000000",
    interest: "Renting",
    message: "Looking for a 2BR in JVC",
    page: "/contact",
  });
  assert.ok(lead);
  assert.equal(lead.source, "website");
  assert.equal(lead.stage, "new");
  assert.equal(lead.full_name, "Amal Perera");
  assert.equal(lead.intent, "long_term_rent");
  assert.equal(lead.notes, "Looking for a 2BR in JVC");
  assert.equal((lead.raw_payload as Record<string, unknown>).page, "/contact");
});

test("form ids decide the interest", () => {
  const base = { name: "A", email: "a@example.com" };
  assert.equal(leadFromWebsite({ ...base, form: "off-plan-interest" })?.intent, "buy_off_plan");
  assert.equal(leadFromWebsite({ ...base, form: "list-your-property" })?.intent, "sell");
  assert.equal(leadFromWebsite({ ...base, form: "property-management" })?.intent, "property_management");
  assert.equal(leadFromWebsite({ ...base, form: "fit-out" })?.intent, "interior_design");
  assert.equal(leadFromWebsite({ ...base, form: "property-alert", lookingTo: "rent" })?.intent, "long_term_rent");
  assert.equal(leadFromWebsite({ ...base, form: "property-enquiry", listingTitle: "Spacious 2BR" })?.intent, "buy_secondary");
});

test("a stay request keeps its dates and party size", () => {
  const lead = leadFromWebsite({
    form: "book-a-stay",
    name: "Guest",
    phone: "+94770000000",
    checkIn: "2026-12-20",
    checkOut: "2026-12-27",
    guests: "3",
  });
  assert.equal(lead?.intent, "short_term_stay");
  assert.equal(lead?.stay_check_in, "2026-12-20");
  assert.equal(lead?.stay_check_out, "2026-12-27");
  assert.equal(lead?.party_size, 3);
});

test("job applications, newsletter sign-ups and uncontactable forms are not leads", () => {
  assert.equal(leadFromWebsite({ form: "careers", name: "A", email: "a@example.com" }), null);
  assert.equal(leadFromWebsite({ form: "newsletter", email: "a@example.com" }), null);
  assert.equal(leadFromWebsite({ form: "contact", name: "A" }), null);
});

test("humanise turns field ids into labels", () => {
  assert.equal(humanise("listingRef"), "Listing ref");
  assert.equal(humanise("book-a-stay"), "Book a stay");
});
