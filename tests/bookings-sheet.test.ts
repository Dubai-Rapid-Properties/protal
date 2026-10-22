import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apartmentKey,
  matchBooking,
  matchUnit,
  parseBookingsSheet,
  parseSheetDate,
  parseSheetTime,
  sheetCsvUrl,
  type PortalBooking,
  type PortalUnit,
} from "@/lib/sheet/bookings-sheet";

const SHEET = `GUEST,Activity type,Check IN,Check OUT,Location,Apartment Number,Source,Comments
Alexey,Currently Hosting,12-Aug-2026,6-Nov-2026,Shoreline,208,Private Guest,
Djafar,Upcoming,29-Oct-2026,1-Dec-2026,Golf Links,406,Private Guest,booking.com guest
Syed Rehan,Upcoming,14-Dec-2026,4-Jan-2027,Sparkle Tower,1307,Private Guest,OWNER STAY
Nabil,Upcoming,29-Dec-2026,11-Jan-2027,Zumurud Tower Dubai Marina,309,AIRBNB Old,
Rita,Upcoming,23-Nov-2026,10-Dec-2026,"Cloud Tower by Tiger Properties, JVT",2704,AIRBNB New,
Marius,CANCELED,5-May-2026,14-May-2026,Sparkle Towers,1307,AIRBNB Old,Flight canceled
 ,Upcoming,,,,,,
Broken,Upcoming,soon,later,Apex,1907,Private Guest,
Old,Completed,12-Aug-2026,26-Jul-2026,Apex,1907,AIRBNB New,extended
Lubow,Upcoming,28-Dec-2026,10-Jan-2027,Sparkle Towers,1408,AIRBNB New,old booking- conflict for owner stay (1307)
`;

const UNITS: PortalUnit[] = [
  { id: "u208", unitNumber: "208", propertyName: "Al Hallawi, Shoreline 14" },
  { id: "u406c", unitNumber: "406", propertyName: "Cloud Tower" },
  { id: "u406g", unitNumber: "406", propertyName: "Golf Links" },
  { id: "u1307", unitNumber: "1307", propertyName: "Sparkle Towers" },
  { id: "u309", unitNumber: "309", propertyName: "Zumurud Tower" },
  { id: "u3001", unitNumber: "3001", propertyName: "The Palm Tower" },
  { id: "u3302", unitNumber: "B3302", propertyName: "DAMAC Park Towers" },
  { id: "um20", unitNumber: "M20", propertyName: "Seven Palm" },
];

test("reads rows, statuses, channels and owner stays; skips blanks, reports bad dates", () => {
  const { rows, problems } = parseBookingsSheet(SHEET);
  assert.equal(rows.length, 7);
  assert.deepEqual(problems, ['Row 9 (Broken): check-in/check-out dates not readable.']);
  const [alexey, djafar, syed, nabil, rita, marius] = rows;
  assert.deepEqual([alexey.checkIn, alexey.checkOut, alexey.status, alexey.channel], ["2026-08-12", "2026-11-06", "hosting", "direct"]);
  assert.equal(djafar.channel, "booking_com");
  assert.equal(syed.ownerStay, true);
  assert.equal(nabil.channel, "airbnb");
  assert.equal(rita.channel, null, "the current Airbnb account is left to its calendar feed");
  assert.equal(marius.status, "cancelled");
  assert.equal(rows[6].ownerStay, false, "a comment mentioning an owner stay is not one");
});

test("optional time columns", () => {
  const { rows } = parseBookingsSheet(
    "GUEST,Check IN,Check OUT,Apartment Number,Check IN time,Check OUT time\nAnna,1-Dec-2026,5-Dec-2026,208,10:00,4 PM\n"
  );
  assert.deepEqual([rows[0].checkInTime, rows[0].checkOutTime], ["10:00", "16:00"]);
});

test("dates and times in the forms people type", () => {
  assert.equal(parseSheetDate("28-Apr-2026"), "2026-04-28");
  assert.equal(parseSheetDate("1 September 2026"), "2026-09-01");
  assert.equal(parseSheetDate("2026-12-31"), "2026-12-31");
  assert.equal(parseSheetDate("05/01/2027"), "2027-01-05");
  assert.equal(parseSheetDate("31-Feb-2026"), null);
  assert.equal(parseSheetTime("9:30"), "09:30");
  assert.equal(parseSheetTime("12am"), "00:00");
  assert.equal(parseSheetTime("late"), null);
});

test("sheet links become the CSV export address", () => {
  assert.equal(
    sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc-123_X/edit?usp=sharing"),
    "https://docs.google.com/spreadsheets/d/abc-123_X/export?format=csv"
  );
  assert.equal(
    sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=42"),
    "https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=42"
  );
  assert.equal(sheetCsvUrl("abc"), "https://docs.google.com/spreadsheets/d/abc/export?format=csv");
});

test("units: apartment number plus a building word; never a guess", () => {
  assert.equal(apartmentKey("208 Shoreline"), "208");
  assert.equal(apartmentKey("3302B"), "3302");
  const unit = (location: string, apartment: string) => matchUnit({ location, apartment }, UNITS)?.id ?? null;
  assert.equal(unit("Shoreline", "208"), "u208");
  assert.equal(unit("Al Hallawi, Shoreline 14", "208 Shoreline"), "u208");
  assert.equal(unit("Golf link apartment", "406"), "u406g");
  assert.equal(unit("Cloud Tower by Tiger Properties, JVT", "406A"), "u406c");
  assert.equal(unit("The St. Regis Dubai, The Palm", "3001"), "u3001");
  assert.equal(unit("Park Tower", "3302B"), "u3302");
  assert.equal(unit("Seven Palm Hotel & Apartments", "m20"), "um20");
  assert.equal(unit("Churchill Tower", "2407"), null, "no such unit");
  assert.equal(unit("Somewhere Else", "406"), null, "number alone is not enough");
});

const booking = (b: Partial<PortalBooking>): PortalBooking => ({
  id: "b",
  status: "confirmed",
  checkIn: "2026-08-12",
  checkOut: "2026-11-11",
  guestName: null,
  sheetName: null,
  icalUid: null,
  ...b,
});

test("bookings: the one typed in for the stay, never a feed booking", () => {
  const [alexey] = parseBookingsSheet(SHEET).rows;
  // Typed in as "Alexy" to 11 Nov: same check-in day.
  assert.equal(matchBooking(alexey, [booking({ id: "typed", guestName: "Alexy" })])?.id, "typed");
  // An Airbnb feed stay overlapping is not it.
  assert.equal(
    matchBooking(alexey, [booking({ id: "feed", guestName: "Alexey", icalUid: "x@airbnb.com", checkIn: "2026-10-01" })]),
    null
  );
  // Another guest's stay that merely overlaps is not it.
  assert.equal(matchBooking(alexey, [booking({ id: "other", guestName: "Maria", checkIn: "2026-11-01" })]), null);
  // One the sheet made before is found again after its dates moved.
  assert.equal(
    matchBooking(alexey, [
      booking({ id: "old", sheetName: "alexey", checkIn: "2026-08-10", checkOut: "2026-11-01" }),
      booking({ id: "other", guestName: "Alexey", checkIn: "2026-11-20", checkOut: "2026-11-25" }),
    ])?.id,
    "old"
  );
  // A live booking is preferred to a cancelled one for the same stay.
  assert.equal(
    matchBooking(alexey, [
      booking({ id: "gone", sheetName: "alexey", status: "cancelled" }),
      booking({ id: "live", sheetName: "alexey" }),
    ])?.id,
    "live"
  );
});
