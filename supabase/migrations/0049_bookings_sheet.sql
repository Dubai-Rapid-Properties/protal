-- ============================================================================
-- D|R|P PMS - 0049 The admin team's bookings sheet feeds the portal
--
-- The admin team keeps direct and old-Airbnb-account stays in a Google
-- Sheet. Every 15 minutes the calendar cron reads it (src/lib/sheet/sync.ts)
-- and brings its stays from today on into the portal; the sheet decides their
-- dates and cancellations. Stays from the current Airbnb account are left to
-- their calendar feed.
--
--   * bookings.sheet_name: the guest as the sheet names them, on bookings the
--     sheet made or took over - how the next read finds them again.
--   * import_source 'bookings_sheet': made by the first read of the sheet,
--     which records what is there without announcing it to owners.
--   * bookings_sheet_sync: the last read - when, what it did, and the rows it
--     could not place, for the Calendar sync page.
-- ============================================================================

alter table bookings add column if not exists sheet_name text;

comment on column bookings.sheet_name is
  'The guest as the bookings sheet names them; set on bookings the sheet sync made or took over.';

create index if not exists bookings_sheet_name_idx on bookings (unit_id, sheet_name) where sheet_name is not null;

alter table bookings drop constraint if exists bookings_import_source_check;
alter table bookings add constraint bookings_import_source_check
  check (import_source is null or import_source in ('earnings_csv', 'feed_first_read', 'bookings_sheet'));

create table if not exists bookings_sheet_sync (
  id         boolean primary key default true check (id),
  synced_at  timestamptz not null default now(),
  ok         boolean not null default true,
  rows_read  integer not null default 0,
  created    integer not null default 0,
  updated    integer not null default 0,
  cancelled  integer not null default 0,
  problems   jsonb not null default '[]'::jsonb
);

comment on table bookings_sheet_sync is
  'The last read of the admin bookings sheet: one row, written by the calendar cron.';

alter table bookings_sheet_sync enable row level security;

create policy bookings_sheet_sync_staff_read on bookings_sheet_sync
  for select to authenticated
  using (pms.is_staff());
