import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildStatementEmail, statementFilename, type EmailLine } from "@/lib/statements/email";
import { buildStatementPdf } from "@/lib/statements/pdf";

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

const statement = {
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
};

const lines = [
  line({
    amount_aed: 4087.97,
    total_aed: 4087.97,
    guest_name: "Anna Lee 李",
    check_in: "2026-09-28",
    check_out: "2026-12-01",
    nights: 18,
    mgmt_fee_aed: 817.59,
    mgmt_fee_vat_aed: 40.88,
  }),
  line({ direction: "expense", category_code: "EXP-OTHER-FEES", description: "DEWA", amount_aed: 350, total_aed: 350 }),
];

const company = { legal_name: "DRP Real Estate Brokers LLC", vat_rate: 0.05 };

test("the email only says which period the attached statement covers", () => {
  const { subject, text, html, filename } = buildStatementEmail({
    statement,
    ownerName: "Zhejun <Shen>",
    company,
    portalUrl: "https://owner.drp.test",
  });
  assert.equal(subject, "Owner statement DRP-STM-2026-0010, 16 Sep 2026 – 15 Oct 2026");
  assert.equal(filename, "Owner-statement-DRP-STM-2026-0010.pdf");
  assert.match(text, /Dear Zhejun <Shen>/);
  assert.match(text, /attached your owner statement for the period 16 Sep 2026 – 15 Oct 2026 \(DRP-STM-2026-0010\)/);
  assert.doesNotMatch(text, /AED/);
  assert.match(html, /Zhejun &lt;Shen&gt;/);
});

test("the file name keeps only safe characters", () => {
  assert.equal(statementFilename("DRP/STM 1"), "Owner-statement-DRPSTM1.pdf");
});

test("the PDF has the summary page and the booking page, whatever the guest's name", async () => {
  const bytes = await buildStatementPdf({ statement, lines, owner: { full_name: "Zhejun Shen" }, company });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getTitle(), "Owner statement DRP-STM-2026-0010");
});

test("many bookings run onto more pages", async () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    line({ amount_aed: 100, total_aed: 100, guest_name: `Guest ${i}`, check_in: "2026-09-20", check_out: "2026-09-22", nights: 2, mgmt_fee_aed: 20, mgmt_fee_vat_aed: 1 })
  );
  const bytes = await buildStatementPdf({ statement, lines: many, owner: { full_name: "Zhejun Shen" }, company });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3);
});

test("a stay's dates on the statement stay inside its period", async () => {
  const { stayInPeriod } = await import("@/lib/statements/summary");
  const l = { check_in: "2026-09-18", check_out: "2027-03-31", entry_date: "2026-10-15" };
  assert.deepEqual(stayInPeriod(l, "2026-09-16", "2026-10-15"), { checkIn: "2026-09-18", checkOut: "2026-10-15" });
  assert.deepEqual(stayInPeriod(l, "2026-10-16", "2026-11-15"), { checkIn: "2026-10-16", checkOut: "2026-11-15" });
  assert.deepEqual(stayInPeriod(l, "2027-03-16", "2027-04-15"), { checkIn: "2027-03-16", checkOut: "2027-03-31" });
  assert.deepEqual(
    stayInPeriod({ check_in: null, check_out: null, entry_date: "2026-10-01" }, "2026-09-16", "2026-10-15"),
    { checkIn: null, checkOut: "2026-10-01" }
  );
});
