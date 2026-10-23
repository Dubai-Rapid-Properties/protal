import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatementEmail, type EmailLine } from "@/lib/statements/email";

const line = (over: Partial<EmailLine>): EmailLine => ({
  direction: "income",
  category_code: "INC-BOOKING",
  description: "Stay DRP-BKG-1",
  entry_date: "2026-10-15",
  unit_label: "Cloud Tower - 406",
  amount_aed: 0,
  total_aed: 0,
  guest_name: null,
  check_in: null,
  check_out: null,
  nights: null,
  mgmt_fee_aed: null,
  mgmt_fee_vat_aed: null,
  ...over,
});

const input = {
  statement: {
    statement_number: "DRP-STM-2026-0010",
    period_start: "2026-09-16",
    period_end: "2026-10-15",
    bookings_count: 1,
    rented_nights: 18,
    occupancy_pct: 60,
    management_fee_pct: 20,
    gross_income_aed: 4087.97,
    management_fee_aed: 817.59,
    vat_total_aed: 40.88,
    net_payout_aed: 2879.5,
  },
  lines: [
    line({
      amount_aed: 4087.97,
      total_aed: 4087.97,
      guest_name: "Anna <Lee>",
      check_in: "2026-09-28",
      check_out: "2026-12-01",
      nights: 18,
      mgmt_fee_aed: 817.59,
      mgmt_fee_vat_aed: 40.88,
    }),
    line({ direction: "expense", category_code: "EXP-OTHER-FEES", description: "DEWA", amount_aed: 350, total_aed: 350 }),
  ],
  ownerName: "Zhejun Shen",
  company: { legal_name: "DRP Real Estate Brokers LLC", vat_rate: 0.05 },
  portalUrl: "https://owner.drp.test",
};

test("the statement email carries the summary and adds up to the net payout", () => {
  const { subject, text } = buildStatementEmail(input);
  assert.equal(subject, "Your owner statement DRP-STM-2026-0010, 16 Sep 2026 – 15 Oct 2026");
  assert.match(text, /Dear Zhejun Shen/);
  assert.match(text, /Bookings: 1 {3}Nights rented: 18 {3}Occupancy: 60\.0%/);
  assert.match(text, /Total gross booking income: AED\s?4,087\.97/);
  assert.match(text, /Less: total expenses: \(AED\s?350\.00\)/);
  assert.match(text, /Less: total management fee \(20% \+ VAT 5%\): \(AED\s?858\.47\)/);
  assert.match(text, /Net income payable to you: AED\s?2,879\.50/);
  assert.match(text, /Anna <Lee>, 28 Sep 2026 – 01 Dec 2026, 18 nights: rent AED\s?4,087\.97, fee \(AED\s?858\.47\), net AED\s?3,229\.50/);
  assert.doesNotMatch(text, /other charges/i);
});

test("the HTML escapes what staff and guests typed", () => {
  const { html } = buildStatementEmail(input);
  assert.match(html, /Anna &lt;Lee&gt;/);
  assert.doesNotMatch(html, /Anna <Lee>/);
  assert.match(html, /https:\/\/owner\.drp\.test\/logo-white\.png/);
});

test("other charges taken off a statement before 0057 still show, so it adds up", () => {
  const { text } = buildStatementEmail({
    ...input,
    statement: { ...input.statement, net_payout_aed: 2779.5 },
  });
  assert.match(text, /Less: other charges: \(AED\s?100\.00\)/);
});
