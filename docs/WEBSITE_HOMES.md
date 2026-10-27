# Holiday Homes website integration

The portal is the source of truth for the homes on the Holiday Homes website.
Airbnb sync stays here (see CALENDAR_SYNC.md); the website reads from the portal
and pushes its own bookings back.

## Publishing a home
Unit page → **Website**. Fill in the title, area, type, photos and tick **Published**.
Nightly rate, max guests, cleaning fee, weekend rate and weekly/monthly discounts come from the unit itself.
**Where guests sleep** (one line per room, e.g. `Bedroom 1 | 1 king bed`) shows on the website as "Where you'll sleep".
It needs migration `0030_website_beds.sql`; until that has run, the field is not shown and saving works as before.
The database refuses to publish a home that lacks what the website needs (`units_website_ready`).

## Importing a home from its Airbnb listing
Unit → **Website** → **Import from Airbnb** (or `/units/from-airbnb`). Airbnb has no API for listings, so,
like the "Send to D|R|P" reservation button, this runs in the staff member's own browser on airbnb.com;
the portal's server never loads an Airbnb page.

1. **The "Import listing to D|R|P" button** (a bookmarklet; set-up steps are on the import page). On a
   listing (`airbnb.com/rooms/<id>`, or the host's listing editor) it reads the JSON Airbnb ships inside the
   page (`src/lib/airbnb/listing-collect.ts`): title, description, person capacity, bedroom/bath counts,
   available amenities and every photo address on `a0.muscache.com` (the full gallery, host avatars left
   out). It opens the import page with that in the URL fragment (`#…`), which never reaches the server or its
   logs. The fragment is kept under ~60 KB (page text, then the description, then photos are trimmed first),
   well inside what browsers accept; photo addresses go without their `?im_w=` size, about 100 bytes each.
2. **Or paste**: the listing's page source (⌘ + Option + U, which carries the photos; read in the browser by
   the same collector) or its visible text (no photos).
3. **Check**: the page shows what was found, the amenities that map to the website's list
   (`mapAirbnbAmenities` in `src/lib/airbnb/listing-page.ts`; names with no match, or only a loose one such as a
   plain "Elevator", are left out and listed), and picks the unit whose `airbnb_ical_url` carries the listing
   number (else its `airbnb_listing_name`, else the unit the import was opened from). Staff pick the photos
   (at most 60) and whether they replace or follow the unit's current ones.
4. **Photos are copied**, six per request, into the portal's `listing-photos` bucket
   (`copyAirbnbPhotos`): only `https://*.muscache.com` addresses, no redirects followed, 20 s timeout, at most
   10 MB, and only real JPG/PNG/WebP/AVIF (declared type and first bytes). The website never hotlinks
   Airbnb; the Website form also refuses `muscache.com` photo addresses on save.
5. **The unit's Website form opens filled in**: Airbnb's title and description, amenities added to the ticked
   ones, a web address from the title (if the unit has none), and area/type only when the title makes them
   plain. Bedrooms, bathrooms and max guests stay the unit's own unless staff click **Use Airbnb's numbers on
   the unit**. Nothing is saved until **Save website details**, and nothing is published unless **Published**
   is ticked - the `units_website_ready` constraint still applies.

Every field may be missing when Airbnb changes its pages; the form is then filled with what was found.

### Prices from Airbnb
The same button, clicked on the listing's **Pricing** page on Airbnb (Listings → the listing → Pricing),
reads the nightly price, weekend price, weekly and monthly discounts and cleaning fee
(`src/lib/airbnb/listing-prices.ts`: Airbnb's pricing JSON where the page carries it - price factors such as
0.9 become 10 % - else the labels in the page's text; the short-stay cleaning fee is not the cleaning fee).
Staff pick the unit and see each value as old → new before **Save prices to the unit** writes the unit's
own `base_nightly_rate_aed`, `weekend_rate_aed`, `cleaning_fee_aed`, `weekly_discount_pct` and
`monthly_discount_pct` (migration 0020). Only AED: a page in another currency is shown as such and nothing
can be saved. Prices are read only from Airbnb's host pages (or pasted text with the pricing labels), never
from the guest listing page, whose prices include Airbnb's fees.

Seasonal rates: clicked on the listing's host **Calendar**, the button reads days whose accessible label
(or title) carries a date and a price. The coming year's nights that differ from the nightly rate become
`website_seasons` rows, consecutive nights at one price merged (`from` and `to` are both nights of the stay),
and replace the website's seasons only if staff leave that ticked. Whether Airbnb's calendar labels its days
this way has not been confirmed on a live page; when it does not, no seasons are offered.

**Automatic sync (extension 1.1+).** While a listing's Pricing or Calendar page is open on Airbnb, the
extension reads it each time its prices change on screen and posts it to `POST /units/from-airbnb/sync`
(as the signed-in staff member, `units.manage`). The unit whose Airbnb calendar address carries the
listing's number takes the shown rates at once (`src/lib/airbnb/price-sync.ts`): AED only, a value
missing from the page never clears the unit's, a nightly rate of 0 is ignored, and calendar nights
replace the website's seasons only for the dates they cover (nights at the nightly or Fri/Sat weekend
rate need no row). A note on Airbnb says what changed; the button's menu turns the sync off per browser.
Airbnb is never asked by the portal, so Smart Pricing changes arrive only when that page is opened.

## API (service-to-service)
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/public/homes` | none | published, active homes, each with its current DET permit number (`permitNumber`, null without a valid permit) and sleeping arrangements (`beds`: `[{room, beds}]`) |
| `GET /api/public/availability` | none | busy ranges per slug (bookings + Airbnb/Booking.com blocks) |
| `POST /api/public/bookings` | `Bearer WEBSITE_API_KEY` | website booking → `website_book_unit()` (409 if dates taken) |
| `PATCH /api/public/bookings/{ref}` | `Bearer WEBSITE_API_KEY` | `confirmed` or `cancelled` |

## Set up
1. Apply `supabase/migrations/0029_website_homes.sql` to Supabase.
2. Set `WEBSITE_API_KEY` (any long random string) on the portal; set the same value as `PORTAL_API_KEY` on the website, with `PORTAL_API_URL` = the portal's address.
