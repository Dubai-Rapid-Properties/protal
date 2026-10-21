# D|R|P PMS — Architecture

Dubai-first property management system for D|R|P: long-term leasing, Holiday
Homes, owner and tenant portals, finance and compliance.

Everything below is UAE-native rather than a generic PMS with local fields bolted
on. AED is the base currency, VAT is decided per line item, and the regulators
(RERA/DLD via Ejari, DET formerly DTCM, Mollak) are modelled as first-class
concerns rather than free-text notes.

---

## 1. Stack and why

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16 (App Router), TypeScript | Server Components + Server Actions; no separate API tier needed for the back office |
| Database | Supabase Postgres | Row Level Security is the access-control mechanism, not an add-on |
| Auth | Supabase Auth | `profiles.role` drives both RLS and the UI |
| Data access | Supabase typed client | Chosen over Drizzle deliberately — see below |
| Storage | Supabase Storage behind `lib/storage` | Private buckets, short-lived signed URLs |
| UI | Tailwind v4 + hand-rolled shadcn-style primitives on Radix | |
| Deploy | Vercel initially | Nothing assumes Vercel; see §7 |

**Why the Supabase client rather than Drizzle.** The brief allowed either. RLS is
the security boundary here, and Drizzle talks to Postgres over a direct
connection that bypasses RLS entirely — every query would have to re-implement
the access rules in TypeScript, and any missed `where` clause becomes a data
leak. The Supabase client carries the user's JWT, so the database enforces
access on every query. Types are generated from the live schema by
`scripts/gen-types.mjs`, so the SQL migrations stay the single source of truth
and the two cannot drift.

---

## 2. Database schema

55 tables, 5 views, 48 enums. Full DDL in `supabase/migrations/`, applied in
filename order.

| Migration | Contents |
|---|---|
| `0001_foundation` | Extensions, all enums, the private `pms` helper schema |
| `0002_identity_property` | `profiles`, `company_settings`, community → property → unit, media, staff scoping |
| `0003_owners` | Owners, bank accounts, fractional ownership, management agreements |
| `0004_leasing` | Tenancies, occupants, cheque schedules, deposits, rent-increase and other notices, UAEDDS mandates |
| `0005_short_term` | DET permits, channel listings, pricing hooks, guests, bookings, availability, housekeeping |
| `0006_finance` | GL categories, ledger, invoices, payments, Mollak service charges, owner statements |
| `0007_maintenance_documents` | Vendors, tickets, preventive maintenance, document vault, compliance alerts, audit log |
| `0008_crm_comms_addons` | Leads, viewings, message templates and log, service orders, fleet |
| `0009_views_access` | RLS helper functions and the reporting views |
| `0010_rls` | Row Level Security policies for every table |
| `0011_functions` | Reference numbering, cheque schedules, statement generation, storage buckets |
| `0012_grants` | Explicit privilege grants; `anon` gets nothing |
| `0013_current_profile` | One-round-trip profile lookup (see §8) |

### Core relationships

```
communities ─< properties ─< units ─< unit_ownerships >─ owners
                               │                          │
                               │                          ├─< owner_bank_accounts
                               │                          ├─< owner_users >─ profiles
                               │                          └─< owner_statements ─< owner_statement_lines
                               │
                               ├─< management_agreements >─ owners
                               ├─< leases >─ tenants
                               │     ├─< lease_occupants        (Ejari declaration)
                               │     ├─< lease_installments     (cheque schedule)
                               │     ├─< deposit_transactions
                               │     ├─< rent_increase_notices  (RERA index)
                               │     └─< lease_notices
                               ├─< holiday_home_permits         (DET)
                               ├─< channel_listings             (Airbnb / Booking.com)
                               ├─< bookings ─< booking_guests   (guest registration)
                               │     └─< housekeeping_tasks
                               ├─< ledger_entries >─ gl_categories
                               ├─< maintenance_requests >─ vendors
                               ├─< service_charge_invoices      (Mollak)
                               └─< documents                    (vault)
```

### Rules the database enforces (not the UI)

These are constraints and triggers, so they hold regardless of which client
writes the data:

- **Ownership shares cannot exceed 100%** per unit (`check_ownership_total`).
- **No overlapping tenancies** on a unit — a GiST exclusion constraint over
  `(unit_id, daterange(start, end))` for non-terminal statuses.
- **No double bookings** — the same, half-open so a same-day
  checkout→check-in turnaround is still allowed.
- **No short-term listing or booking without a valid DET permit.**
  `enforce_permit_before_listing` and `enforce_permit_before_booking` reject the
  write and stamp the permit number onto the listing (DET requires it on every
  OTA listing) and onto the booking record.
- **Maintenance above the configured threshold cannot start without owner
  approval** — `flag_owner_approval` raises if the status advances while
  `owner_approved_at` is null.
- **Ejari occupant currency** — any change to `lease_occupants` clears
  `leases.ejari_occupants_synced_at`, which starts the 30-day clock the
  compliance calendar reports on (2026 requirement).
- **Rent-increase notices** must respect the statutory notice period:
  `effective_date >= notice_date + required_notice_days`.
- **Audit trail** — `pms.write_audit()` fires on every financial and compliance
  table. It is `SECURITY DEFINER` and `audit_log` has no insert policy, so
  application code cannot bypass or forge it.

### Money and VAT

Every stored amount is AED and VAT-exclusive; `vat_amount_aed` is separate and
`total_aed` is generated. **VAT applicability is a per-line-item flag, never a
document-level or global rule** — long-term residential rent is exempt while the
management fee on the very same owner statement is standard-rated. Defaults come
from `gl_categories.default_vat_applicable`, which Finance can configure; each
line can override. The rate itself lives in `company_settings.vat_rate`.

Foreign currency exists only for display to guests (`quoted_currency`,
`fx_rate_to_aed` on bookings). It never enters the ledger.

`generate_owner_statement()` computes:

```
net payout = collected income − owner expenses (incl. VAT) − management fee − VAT on fee
```

Every line is **snapshotted** onto `owner_statement_lines` and the source ledger
row is stamped with the statement id, so the same income can never be paid out
twice and re-issuing a statement cannot silently restate history.

### Views

| View | Purpose |
|---|---|
| `v_units_overview` | The unit list/card shape — property, owner, live lease, live permit, cover image, open tickets |
| `v_compliance_calendar` | Union of every expiry: Ejari, occupant declarations, tenancy, DET permit, NOC, management agreement, any vault document, preventive maintenance, fleet |
| `v_compliance_status` | The above with severity banding (`ok` / `due_soon` / `urgent` / `overdue`) |
| `v_unit_financials` | Per-unit monthly income/expense rollup |
| `v_occupancy_daily` | Long-term vs short-term occupancy per unit per day |

All are `security_invoker`, so RLS follows through the view.

---

## 3. Access control

Two layers, and only one of them is the security boundary.

**The database (authoritative).** Every table has RLS enabled *and forced*.
Policies resolve a user to the units they may see through helper functions in
the private `pms` schema:

| Role | Sees |
|---|---|
| `super_admin` | Everything |
| `finance` | Everything financial; no property CRUD |
| `property_manager`, `agent`, `maintenance` | Only units assigned via `staff_unit_assignments` / `staff_property_assignments` — deny by default |
| `marketing` | Units and listing content; never financials |
| `owner` | Units they own, via `owner_users → unit_ownerships`; issued statements only |
| `tenant` | Their own tenancy, via `tenants.profile_id` |
| `guest` | Their current/recent booking, via `guests.profile_id` |

The helpers (`pms.can_read_unit`, `pms.can_read_lease`, `pms.is_my_tenant_record`
…) are `SECURITY DEFINER`. That is not incidental: policies on `leases` and
`tenants` referencing each other directly caused genuine infinite policy
recursion, and wrapping each cross-table lookup in a definer function is what
breaks the cycle.

`owner_bank_accounts` and documents flagged `is_sensitive` are restricted
further — finance and admin only, plus the party the record belongs to.

**The application (cosmetic).** `src/lib/auth/rbac.ts` holds a capability matrix
used to decide what to render and which routes to offer. It mirrors the policies
but is *not* relied on for safety: the database refuses anything it would
wrongly allow.

The `service_role` key bypasses RLS entirely and is used only for background
jobs (alert sweeps, scheduled statement runs) — never to serve a user request.

---

## 4. Route structure

```
/                             → redirect by role
/login                        credentials
/setup                        shown when Supabase is not configured

(staff)  — back office, requires a staff role
  /dashboard                  portfolio, compliance exposure, month position
  /compliance                 unified renewal calendar + health score
  /properties                 buildings and compounds
  /properties/new             create, with inline community creation
  /units                      filterable list + CSV export
  /units/new                  create, with ownership captured at the same time
  /units/[id]                 overview · tenancy · DET permits · documents
  /owners                     list + CSV export
  /owners/new                 create, incl. restricted payout details
  /owners/[id]                profile · units · statements · documents
  /leases                     list, with the 90-day notice window flagged
  /leases/new                 contract + cheque schedule in one step
  /leases/[id]                details · payments · occupants · documents
  /finance                    ledger with VAT per line
  /finance/statements         list, generate
  /finance/statements/[id]    printable A4 statement
  /settings                   VAT, fees, notice periods, thresholds

portal   — owners, tenants, guests
  /portal/owner               income, occupancy, approvals waiting on them
  /portal/owner/units
  /portal/owner/statements    issued statements only
  /portal/owner/statements/[id]
  /portal/owner/maintenance   approve or decline quotes above threshold
  /portal/owner/documents
  /portal/tenant              tenancy, payment schedule, documents
  /portal/guest               booking and check-in details
```

Navigation is generated from capabilities (`components/layout/nav.ts`), so
granting a capability in `rbac.ts` surfaces the matching section automatically.
Only built routes are listed there — Phase 2 surfaces are added as they are
built rather than left as dead links, so the delivered app has none.

---

## 5. Shared components

| Component | Role |
|---|---|
| `domain/shared.tsx` | `PageHeader`, `StatCard`, `Money`, `Field`/`FieldGrid`, `EmptyState`, `Callout` |
| `domain/status-badge.tsx` | One badge per domain status, with fixed colour semantics: green healthy, amber attention, red blocking, grey inert |
| `domain/document-list.tsx` + `document-uploader.tsx` | The vault UI. Statutory document types require an expiry date, which is what keeps the compliance calendar complete |
| `domain/statement-document.tsx` | The printable owner statement |
| `domain/export-button.tsx` | RFC 4180 CSV export, on every table |
| `layout/sidebar.tsx` | Capability-filtered navigation, responsive drawer |
| `lib/labels.ts` | Every enum → human label. This is the seam an Arabic locale layer plugs into |

Documents are never public: the buckets are private and the UI mints a
five-minute signed URL on click, after RLS has already decided the user may see
the row.

PDFs are produced by print stylesheet rather than a PDF engine — smaller,
searchable, keeps Arabic selectable, and no extra dependency.

---

## 6. Integration seams

All stubbed behind interfaces so business logic never branches on a vendor:

| Concern | Module | Status |
|---|---|---|
| Payments | `lib/payments` | `manual` driver (cheques, transfers) is the default and real. Ziina/Telr/Network/Stripe drivers are declared and throw until implemented |
| WhatsApp / email / SMS | `lib/messaging` | WhatsApp Business API and Resend implemented; no-op driver logs instead of sending when unconfigured |
| Storage | `lib/storage` | Supabase driver live; S3 driver stubbed for an AWS move |
| Channel manager | `channel_listings` table | Data model and sync fields exist; OTA API calls are Phase 3 |
| Dynamic pricing | `pricing_connections`, `nightly_rates` | Integration point only — the pricing engine stays external |
| E-signature | `leases.signature_provider` / `signature_reference` | Provider-agnostic fields so UAE Pass / Dubai REST needs no migration |
| Direct debit | `direct_debit_mandates` | UAEDDS record exists; collection flow is Phase 3 |

---

## 7. Portability

The brief asked that a later move into D|R|P's AWS account not be made harder
than necessary:

- **No configuration in code.** Everything enters through `src/lib/env.ts`;
  nothing else reads `process.env` (bar the two `NEXT_PUBLIC_` values the browser
  bundle must inline).
- **Storage behind an interface**, with the S3 driver already stubbed.
- **Nothing assumes Vercel** — no `@vercel/*` imports, no platform-specific APIs.
  The frontend can move to Amplify or ECS unchanged.
- **The schema is plain PostgreSQL.** Supabase-specific surface is confined to
  `auth.uid()`, `auth.users` and `storage.*`. `supabase/local/00_shim.sql`
  reproduces exactly that surface, which is how the whole schema is tested
  against stock Postgres — and is also the shape of the work if the backend ever
  moves to RDS + Cognito.

---

## 8. Performance

Measured against a live Supabase project from Colombo, with the project in a
distant region:

| | |
|---|---|
| Round trip to Supabase | ~176 ms |
| Query execution itself | ~15 ms |
| Added by RLS | ~15 ms |
| Page load, `npm run dev` | 1,400-2,300 ms |
| Page load, production build | 410-540 ms |

Two things follow from this.

**The database is not the bottleneck.** Warm queries land within a few
milliseconds of the raw network round trip, RLS included. Do not optimise SQL
here without measuring first.

**Region choice dominates.** Each page makes a small number of sequential hops
to Supabase (session refresh in the proxy, profile lookup, then the page's own
queries run in parallel). At 176 ms per hop that is ~420 ms of pure distance.
Hosting the project near the operator - `ap-south-1` (Mumbai) or
`ap-southeast-1` (Singapore) for a Dubai/Colombo team - takes the round trip to
40-60 ms and pages to roughly 200 ms. A project's region cannot be changed after
creation, so this is worth getting right before go-live.

**Current setup:** Supabase in `ap-south-1` (Mumbai), Vercel functions in `bom1`
(Mumbai, `vercel.json`), so the server and the database sit in the same region.
Measured from Dubai when the project moved from `ap-southeast-2` (Sydney): one
round trip 409 ms -> 65 ms; the unit page's full data batch ~400 ms (spikes over
1 s) -> ~80-140 ms. Pages also send all their queries as one parallel batch, so
each page costs a single round trip. `scripts/copy-supabase-project.mjs` is how
the data was moved, and can move it again.

**On Cloudflare Workers** the code no longer runs in `bom1`, so `wrangler.jsonc`
pins the Worker with `"placement": { "region": "aws:ap-south-1" }`. Without it
the Worker runs at the visitor's nearest edge and each Supabase query crosses to
Mumbai. If the Supabase region ever changes, change this with it.

Two fixes already applied:

- `current_profile()` (migration 0013) returns the signed-in user's profile in
  one round trip instead of `getUser()` followed by a select. Worth ~180 ms per
  page. The app falls back to the two-call path if the function is absent, and
  remembers that for the process rather than retrying every request.
- The proxy matcher exempts `manifest.webmanifest`, icons and fonts. Without
  that the browser's manifest request on every page load was redirected to
  `/login`, costing a round trip and leaving the PWA manifest unreadable.

Always benchmark with `npm run build && npm run start`; `npm run dev` compiles
on demand and is roughly three times slower, which is not representative.

---

## 9. Verification

The schema is not just written; it is exercised.

```bash
bash supabase/local/rebuild.sh     # migrations + 17 assertions against real Postgres
```

`supabase/local/02_smoke_test.sql` asserts the rules the brief treats as
non-negotiable: ownership ≤ 100%, cheque splits with no rounding loss, cleared
rent posting as VAT-exempt income, owner statement arithmetic, the DET permit
gate on both listings and bookings, no double-booking (but same-day turnaround
allowed), Ejari occupant staleness surfacing in the compliance calendar, the
maintenance approval threshold, and RLS isolation between two owners, a tenant
and a scoped property manager.

---

## 10. Scope delivered

**Phase 1, end to end:** auth and roles; property, unit and owner management
with create forms; long-term leasing with Ejari, cheque schedules and occupant
declarations; finance with the ledger and owner statements; the document vault;
and the compliance dashboard. Tenant and guest logins get a minimal read-only
portal so no role lands on a dead route.

Edit forms for units, owners and properties are not built — records are created
through the app and amended in the database or the Supabase table editor for
now. Everything else in Phase 1 is complete.

**Phase 2 data model is complete** — Holiday Homes, DET permits, bookings,
housekeeping, maintenance and the communication hub all have their tables,
constraints, RLS and seed data. Their back-office screens are the next build
step; no migration will be needed to add them.

**Phase 3** (OTA sync, CRM, analytics, interior design and fleet, Arabic pass,
UAE Pass, UAEDDS) has tables and integration points reserved, nothing more.
