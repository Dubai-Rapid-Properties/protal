import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earningsToBookingAmounts,
  parseAirbnbEarnings,
  parseAmount,
  parseCsv,
} from "@/lib/airbnb/earnings-csv";

// The shape of Airbnb's Transaction history export: a payout row that repeats
// the money, reservation rows with quoted thousands, a long stay paid out in
// two parts, an adjustment, a BOM and CRLF line endings.
const EXPORT =
  "﻿" +
  [
    'Date,Arriving by date,Type,Confirmation code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast pay fee,Cleaning fee,Gross earnings,Occupancy taxes,Earnings year',
    '10/15/2026,10/16/2026,Payout,,,,,,,,"Transfer to ****1234, AED",,AED,,"3,512.00",,,,,,',
    '10/15/2026,,Reservation,HMABCDE123,09/01/2026,10/10/2026,10/15/2026,5,"Maria Lopez","Marina Gate 1 - 2807",,,AED,"3,512.00",,108.00,,250.00,"3,620.00",150.00,2026',
    '11/01/2026,,Reservation,HMLONG0001,09/20/2026,11/01/2026,12/15/2026,44,"John Smith","Opera Grand 505",,,AED,"10,000.00",,300.00,,0.00,"10,300.00",0.00,2026',
    '12/01/2026,,Reservation,HMLONG0001,09/20/2026,11/01/2026,12/15/2026,44,"John Smith","Opera Grand 505",,,AED,"8,500.00",,262.50,,0.00,"8,762.50",0.00,2026',
    '11/03/2026,,Adjustment,HMABCDE123,,,,,,,"Resolution",,AED,-50.00,,,,,,,2026',
  ].join("\r\n");

test("CSV parsing handles quotes, commas, doubled quotes and newlines in fields", () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi""",\r\n"multi\nline",2,3,4\n'), [
    ["a", "b, c", 'say "hi"', ""],
    ["multi\nline", "2", "3", "4"],
  ]);
});

test("amounts: thousands separators, brackets and minus signs", () => {
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("(12.50)"), -12.5);
  assert.equal(parseAmount("-7"), -7);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("AED 99.00"), 99);
});

test("only reservation rows count; a stay paid in parts is summed", () => {
  const { reservations, skipped, errors } = parseAirbnbEarnings(EXPORT);
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, { Payout: 1, Adjustment: 1 });
  assert.equal(reservations.length, 2);

  const maria = reservations.find((r) => r.code === "HMABCDE123")!;
  assert.equal(maria.guest, "Maria Lopez");
  assert.equal(maria.currency, "AED");
  assert.equal(maria.amount, 3512);
  assert.equal(maria.serviceFee, 108);
  assert.equal(maria.cleaningFee, 250);
  assert.equal(maria.grossEarnings, 3620);
  assert.equal(maria.occupancyTaxes, 150);

  const john = reservations.find((r) => r.code === "HMLONG0001")!;
  assert.equal(john.rows, 2);
  assert.equal(john.amount, 18500);
  assert.equal(john.serviceFee, 562.5);
  assert.equal(john.grossEarnings, 19062.5);
});

test("booking amounts: payout = guest total - commission - Tourism Dirham", () => {
  const { reservations } = parseAirbnbEarnings(EXPORT);
  const a = earningsToBookingAmounts(reservations.find((r) => r.code === "HMABCDE123")!, 5);
  assert.deepEqual(a, {
    accommodation_aed: 3370,
    nightly_rate_aed: 674,
    cleaning_fee_aed: 250,
    extra_fees_aed: 0,
    tourism_dirham_aed: 150,
    channel_commission_aed: 108,
    gross_total_aed: 3770,
    payout_expected_aed: 3512,
  });
  assert.equal(
    a.gross_total_aed - a.channel_commission_aed - a.tourism_dirham_aed,
    a.payout_expected_aed
  );
});

test("an export without a gross column derives it from payout plus fee", () => {
  const csv = "Type,Confirmation Code,Currency,Amount,Service Fee,Cleaning Fee\nReservation,HMOLD00001,AED,970.00,30.00,100.00\n";
  const [r] = parseAirbnbEarnings(csv).reservations;
  assert.equal(r.grossEarnings, 1000);
  assert.equal(earningsToBookingAmounts(r, 3).accommodation_aed, 900);
});

test("an export without a service fee column derives the commission from gross less payout", () => {
  const csv = "Type,Confirmation Code,Currency,Amount,Gross Earnings\nReservation,HM39NCHPAH,AED,346.16,413.44\n";
  const [r] = parseAirbnbEarnings(csv).reservations;
  const a = earningsToBookingAmounts(r, 1);
  assert.equal(a.accommodation_aed, 413.44);
  assert.equal(a.channel_commission_aed, 67.28);
  assert.equal(a.payout_expected_aed, 346.16);
});

test("a file that is not the earnings export is refused with a hint", () => {
  const { reservations, errors } = parseAirbnbEarnings("Name,Email\nA,b@c.com\n");
  assert.equal(reservations.length, 0);
  assert.match(errors[0], /Transaction history/);
});

test("stay dates and listing: Airbnb's MM/DD/YYYY, end date is the check-out day", () => {
  const { reservations } = parseAirbnbEarnings(EXPORT);
  const r = reservations.find((x) => x.code === "HMABCDE123")!;
  assert.equal(r.listing, "Marina Gate 1 - 2807");
  assert.equal(r.checkIn, "2026-10-10");
  assert.equal(r.checkOut, "2026-10-15");
});

test("a re-saved file with DD/MM/YYYY dates, or only start date and nights", () => {
  const dayFirst = [
    "Type,Confirmation code,Start date,End date,Nights,Listing,Amount",
    'Reservation,HMDAYFIRST,25/03/2025,02/04/2025,8,"Sea View  Studio",900',
    "Reservation,HMDAYFIR2,03/04/2025,05/04/2025,2,Sea View Studio,200",
  ].join("\n");
  const a = parseAirbnbEarnings(dayFirst).reservations;
  assert.deepEqual(
    a.map((r) => [r.code, r.checkIn, r.checkOut, r.listing]),
    [
      ["HMDAYFIRST", "2025-03-25", "2025-04-02", "Sea View Studio"],
      ["HMDAYFIR2", "2025-04-03", "2025-04-05", "Sea View Studio"],
    ]
  );

  const noEnd = ["Type,Confirmation code,Start date,Nights,Amount", "Reservation,HMNOEND001,2025-12-30,4,500"].join("\n");
  const b = parseAirbnbEarnings(noEnd).reservations[0];
  assert.equal(b.checkIn, "2025-12-30");
  assert.equal(b.checkOut, "2026-01-03", "start + nights, across the year end");

  const none = ["Type,Confirmation code,Amount", "Reservation,HMNODATES1,500"].join("\n");
  const c = parseAirbnbEarnings(none).reservations[0];
  assert.equal(c.checkIn, null);
  assert.equal(c.checkOut, null);
  assert.equal(c.listing, null);
});
