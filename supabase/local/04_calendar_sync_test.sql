-- ============================================================================
-- D|R|P PMS - Airbnb calendar sync (0017)
--
-- Runs after 02 and 03 and reuses their fixtures: unit 2807 (owner B, valid
-- DET permit) and unit 1204 (owner A, long-term, no permit). Dates are
-- relative to today so the suite never goes stale.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/04_calendar_sync_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.feed(variadic ev jsonb[]) returns jsonb
language sql as $$ select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(ev) x $$;

create or replace function pg_temp.ev(uid text, s integer, e integer, kind text default 'reservation', code text default null)
returns jsonb language sql as $$
  select jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e, 'kind', kind, 'code', code)
$$;

create or replace function pg_temp.unit(num text) returns uuid
language sql as $$ select id from units where unit_number = num $$;

-- Run the sync as a staff user, the way "Sync now" does (RLS applies).
create or replace function pg_temp.sync_as(who uuid, unit uuid, events jsonb) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  r := apply_airbnb_ical(unit, events);
  perform set_config('role', 'postgres', true);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 21 - first sync creates the reservation and the Airbnb block.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; b bookings%rowtype; n integer;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 10, 14, 'reservation', 'HMAAAA1111'),
    pg_temp.ev('blk-1@airbnb.com', 20, 22, 'blocked')));

  select * into b from bookings where ical_uid = 'res-1@airbnb.com';
  select count(*) into n from availability_blocks where ical_uid = 'blk-1@airbnb.com' and reason = 'channel_sync';

  if (r->>'created')::int <> 1 or not found or n <> 1 then
    raise exception 'TEST 21 FAILED: %', r;
  end if;
  if b.channel <> 'airbnb' or b.status <> 'confirmed' or b.guest_count_known
     or b.external_booking_id <> 'HMAAAA1111' then
    raise exception 'TEST 21 FAILED: imported row %', row_to_json(b);
  end if;
  if (select ical_last_status from units where id = pg_temp.unit('2807')) <> 'ok' then
    raise exception 'TEST 21 FAILED: sync status not ok';
  end if;
  raise notice 'TEST 21  PASS  reservation imported (code %), Airbnb block recorded, status ok', b.external_booking_id;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 22 - syncing the same feed again changes nothing.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; n integer;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 10, 14, 'reservation', 'HMAAAA1111'),
    pg_temp.ev('blk-1@airbnb.com', 20, 22, 'blocked')));
  select count(*) into n from bookings where ical_uid = 'res-1@airbnb.com';
  if n <> 1 or (r->>'created')::int <> 0 or (r->>'updated')::int <> 0 then
    raise exception 'TEST 22 FAILED: %', r;
  end if;
  raise notice 'TEST 22  PASS  re-sync is idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 23 - a changed stay on Airbnb moves the booking.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; b bookings%rowtype;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 11, 16, 'reservation', 'HMAAAA1111'),
    pg_temp.ev('blk-1@airbnb.com', 20, 22, 'blocked')));
  select * into b from bookings where ical_uid = 'res-1@airbnb.com';
  if b.check_in <> current_date + 11 or b.check_out <> current_date + 16 or (r->>'updated')::int <> 1 then
    raise exception 'TEST 23 FAILED: % %', r, row_to_json(b);
  end if;
  raise notice 'TEST 23  PASS  date change on Airbnb moved the booking (% nights)', b.nights;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 24 - a stay that disappears from the feed is cancelled; a block that
-- disappears is removed.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; b bookings%rowtype; n integer;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'),
                       pg_temp.feed(pg_temp.ev('res-2@airbnb.com', 40, 42)));
  select * into b from bookings where ical_uid = 'res-1@airbnb.com';
  select count(*) into n from availability_blocks where ical_uid = 'blk-1@airbnb.com';
  if b.status <> 'cancelled' or b.cancellation_reason <> 'Removed from the Airbnb calendar feed' or n <> 0 then
    raise exception 'TEST 24 FAILED: % status=% blocks=%', r, b.status, n;
  end if;
  -- The calendar block that mirrors a live booking must go with it.
  if exists (select 1 from availability_blocks where booking_id = b.id) then
    raise exception 'TEST 24 FAILED: cancelled booking still blocks the calendar';
  end if;
  raise notice 'TEST 24  PASS  vanished stay cancelled (%), its dates released', b.cancelled_on;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 25 - if it comes back, it is reinstated rather than duplicated.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; n integer;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 11, 16), pg_temp.ev('res-2@airbnb.com', 40, 42)));
  select count(*) into n from bookings where ical_uid = 'res-1@airbnb.com' and status = 'confirmed';
  if n <> 1 or (r->>'reinstated')::int <> 1 then raise exception 'TEST 25 FAILED: %', r; end if;
  raise notice 'TEST 25  PASS  reappearing stay reinstated';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 26 - a clash with a direct booking is reported; the rest still syncs.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; err text;
begin
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (pg_temp.unit('2807'), 'direct', 'confirmed', current_date + 50, current_date + 55, 2);

  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 11, 16), pg_temp.ev('res-2@airbnb.com', 40, 42),
    pg_temp.ev('res-3@airbnb.com', 53, 57), pg_temp.ev('res-4@airbnb.com', 60, 63)));

  select ical_last_error into err from units where id = pg_temp.unit('2807');
  if (r->>'ok')::boolean or (r->>'created')::int <> 1
     or exists (select 1 from bookings where ical_uid = 'res-3@airbnb.com')
     or not exists (select 1 from bookings where ical_uid = 'res-4@airbnb.com')
     or err !~ 'overlaps DRP-BKG-.* \(direct, ' then
    raise exception 'TEST 26 FAILED: % / %', r, err;
  end if;
  raise notice 'TEST 26  PASS  clash reported ("%"), other stays imported', left(err, 60);
end $$;

-- ---------------------------------------------------------------------------
-- TEST 27 - a hand-entered Airbnb booking is adopted, not duplicated.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; v_manual uuid; n integer;
begin
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, external_booking_id)
  values (pg_temp.unit('2807'), 'airbnb', 'confirmed', current_date + 70, current_date + 73, 3, 'HMMANUAL99')
  returning id into v_manual;

  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), pg_temp.feed(
    pg_temp.ev('res-1@airbnb.com', 11, 16), pg_temp.ev('res-2@airbnb.com', 40, 42),
    pg_temp.ev('res-4@airbnb.com', 60, 63),
    pg_temp.ev('res-5@airbnb.com', 70, 73, 'reservation', 'HMMANUAL99')));

  select count(*) into n from bookings where unit_id = pg_temp.unit('2807') and check_in = current_date + 70
     and status = 'confirmed';
  if n <> 1 or (select ical_uid from bookings where id = v_manual) is distinct from 'res-5@airbnb.com'
     or (select adults from bookings where id = v_manual) <> 3 then
    raise exception 'TEST 27 FAILED: % (rows=%)', r, n;
  end if;
  raise notice 'TEST 27  PASS  manual Airbnb booking adopted, guest count kept';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 28 - no DET permit: Airbnb imports land and are flagged; a direct
-- booking on the same unit is still refused.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; flagged boolean; refused boolean := false;
begin
  r := pg_temp.sync_as('11111111-1111-1111-1111-111111111111', pg_temp.unit('1204'),
                       pg_temp.feed(pg_temp.ev('nopermit-1@airbnb.com', 5, 8)));
  select imported_without_permit into flagged from bookings where ical_uid = 'nopermit-1@airbnb.com';

  begin
    insert into bookings (unit_id, channel, status, check_in, check_out, adults)
    values (pg_temp.unit('1204'), 'direct', 'confirmed', current_date + 20, current_date + 22, 1);
  exception when check_violation then refused := true;
  end;

  if not coalesce(flagged, false) or not refused or not (r->>'ok')::boolean then
    raise exception 'TEST 28 FAILED: % flagged=% refused=%', r, flagged, refused;
  end if;
  raise notice 'TEST 28  PASS  unpermitted unit: import flagged, direct booking still blocked';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 29 - an empty feed with live stays cancels nothing.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; live integer;
begin
  r := pg_temp.sync_as('22222222-2222-2222-2222-222222222222', pg_temp.unit('2807'), '[]'::jsonb);
  select count(*) into live from bookings
   where unit_id = pg_temp.unit('2807') and ical_uid is not null and status = 'confirmed';
  if live < 2 or (r->>'cancelled')::int <> 0 or (r->>'ok')::boolean then
    raise exception 'TEST 29 FAILED: % live=%', r, live;
  end if;
  raise notice 'TEST 29  PASS  empty feed treated as a fault; % stays kept', live;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 30 - a fetch failure is recorded against the unit.
-- ---------------------------------------------------------------------------
do $$
begin
  perform apply_airbnb_ical(pg_temp.unit('2807'), null, 'Airbnb returned HTTP 404');
  if (select ical_last_status || ':' || ical_last_error from units where id = pg_temp.unit('2807'))
     <> 'error:Airbnb returned HTTP 404' then
    raise exception 'TEST 30 FAILED';
  end if;
  raise notice 'TEST 30  PASS  fetch error recorded on the unit';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 31 - the export feed: direct bookings and manual blocks only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text := (select ical_export_token from units where id = pg_temp.unit('2807'));
  kinds text;
  airbnb integer;
begin
  insert into availability_blocks (unit_id, start_date, end_date, reason)
  values (pg_temp.unit('2807'), current_date + 150, current_date + 155, 'owner_stay');

  select string_agg(distinct kind, ',' order by kind) into kinds from ical_export_events(v_token);
  select count(*) into airbnb
    from ical_export_events(v_token) x
    join bookings b on 'booking-' || b.id::text = x.uid
   where b.channel = 'airbnb';

  -- The maintenance block comes from 03's fixtures.
  if kinds is distinct from 'booking,maintenance,owner_stay' or airbnb <> 0 then
    raise exception 'TEST 31 FAILED: kinds=% airbnb=%', kinds, airbnb;
  end if;
  if exists (select 1 from ical_export_events('not-a-real-token')) then
    raise exception 'TEST 31 FAILED: unknown token returned events';
  end if;
  if length(v_token) <> 64 then raise exception 'TEST 31 FAILED: token length %', length(v_token); end if;
  raise notice 'TEST 31  PASS  export has direct bookings + maintenance + owner stay, no Airbnb stays, no channel blocks';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 32 - owners can neither run the sync, read feed secrets, nor call the
-- export function; they do see imported stays, without a guest count.
-- ---------------------------------------------------------------------------
do $$
declare refused integer := 0; tokens integer; n_unknown integer; seen integer; expected integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

  begin
    perform apply_airbnb_ical(pg_temp.unit('2807'), '[]'::jsonb);
  exception when no_data_found or insufficient_privilege then refused := refused + 1;
  end;
  begin
    perform * from ical_export_events('x');
  exception when insufficient_privilege then refused := refused + 1;
  end;
  select count(*) into tokens from units where ical_export_token is not null;
  select count(*), count(*) filter (where v.guests is null) into seen, n_unknown
    from owner_bookings_view v where v.source = 'airbnb';
  reset role;

  -- Imported stays carry no guest count; hand-entered ones keep theirs.
  select count(*) into expected from bookings
   where unit_id = pg_temp.unit('2807') and channel = 'airbnb' and not guest_count_known
     and status in ('confirmed','checked_in','checked_out');

  if refused <> 2 or tokens <> 0 or seen = 0 or expected = 0 or n_unknown <> expected then
    raise exception 'TEST 32 FAILED: refused=% tokens=% seen=% unknown=% expected=%',
      refused, tokens, seen, n_unknown, expected;
  end if;
  raise notice 'TEST 32  PASS  owner blocked from sync/export/tokens; sees % Airbnb stays, % imported ones without a guest count', seen, n_unknown;
end $$;

select 'ALL CALENDAR SYNC TESTS PASSED' as result;
