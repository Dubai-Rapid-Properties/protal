# Airbnb calendar sync

No channel manager: Airbnb and D|R|P exchange iCal feeds.

```
Airbnb listing ──export feed──▶ /api/cron/ical-sync (every 15 min) ──▶ bookings (channel = airbnb)
Airbnb listing ◀──import feed── /api/ical/<secret>.ics ◀── direct / other-channel bookings + manual blocks
```

## One-time setup per unit

1. **Import (Airbnb → D|R|P).** On Airbnb open the listing → Calendar →
   Availability → *Connect calendars* → *Export calendar*, copy the link.
   In the admin portal open the unit → **Calendar** tab → paste it under
   *Airbnb calendar link* → **Save & sync**.
2. **Export (D|R|P → Airbnb).** On the same tab click **Copy link** under
   *Export to Airbnb*. On Airbnb: *Connect calendars* → *Import calendar*,
   paste it, name it "D|R|P". Airbnb refreshes imported calendars on its own
   schedule (typically every few hours).

## One-time setup for the schedule

1. `openssl rand -hex 32` → put it in `.env.local` **and** in Vercel as
   `CRON_SECRET`, then redeploy.
2. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**
   (the script also tries to enable them).
3. `npm run db:cron -- --url https://admin.dubairapidproperties.com`
4. `npm run db:cron -- --status` shows the last runs and HTTP responses.

The same command also schedules `/api/cron/website-rebuild` every hour (at
:23), which rebuilds the D|R|P website through `WEBSITE_DEPLOY_HOOK_URL` so
it shows Property Finder's current listings.

## What the sync does

| On Airbnb | In D|R|P |
|---|---|
| New reservation | Confirmed booking, channel Airbnb, guest count "not provided" (the feed has none) |
| Reservation dates changed | Booking moved |
| Reservation disappears (cancelled) | Future booking cancelled: *Removed from the Airbnb calendar feed* |
| Reservation reappears | Booking reinstated |
| "Not available" block | Calendar block *Not available on Airbnb* (not exported back) |
| Past stays dropping out of the feed | Nothing - that is not a cancellation |

- **Hand-entered Airbnb bookings are adopted**, not duplicated: matched by
  confirmation code (HM…) or identical dates.
- **Clashes** (an Airbnb stay overlapping a direct booking) are not imported;
  the unit shows *Sync problem* with the dates.
- **No DET permit**: Airbnb stays are still imported so their nights stay
  blocked, and flagged on the unit, the booking and the Calendar sync page.
  Direct bookings on such a unit are still refused.
- **Empty feed safeguard**: if the feed comes back empty while two or more
  upcoming stays are synced, nothing is cancelled and the unit shows an error.
- The export lists dates only - "Reserved" / "Blocked" - never guest names or
  prices. Anyone with the link can see which nights are taken; if a link
  leaks, use **New link** and paste the new one into Airbnb.

Status for every unit: admin portal → **Calendar sync**.
