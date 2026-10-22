-- ============================================================================
-- D|R|P PMS - Calendar sync corrects stays typed in with the wrong dates (0046)
--
-- Runs after 02-22. Uses unit 2807 with stays far ahead of the other suites'
-- and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/23_adopt_overlapping_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.feed(variadic ev jsonb[]) returns jsonb
language sql as $$ select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(ev) x $$;

create or replace function pg_temp.ev(uid text, s integer, e integer, kind text default 'reservation', code text default null)
returns jsonb language sql as $$
  select jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e, 'kind', kind, 'code', code)
$$;

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

do $$
declare
  pm uuid := '22222222-2222-2222-2222-222222222222';
  v_unit uuid := (select id from units where unit_number = '2807');
  v_typed uuid;
  v_direct uuid;
  r jsonb;
  n integer;
  b bookings%rowtype;
begin
  -- TEST 230 - an Airbnb stay typed in a day early, with no code, is moved to Airbnb's dates.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'airbnb', 'confirmed', current_date + 450, current_date + 458, 2) returning id into v_typed;
  r := pg_temp.sync_as(pm, v_unit, pg_temp.feed(pg_temp.ev('ov-1@airbnb.com', 451, 458, 'reservation', 'HMOV1')));
  select * into b from bookings where id = v_typed;
  select count(*) into n from bookings
   where unit_id = v_unit and status <> 'cancelled' and check_in between current_date + 440 and current_date + 460;
  if b.check_in <> current_date + 451 or b.check_out <> current_date + 458 or b.ical_uid is distinct from 'ov-1@airbnb.com'
     or n <> 1 or (r->>'ok')::boolean is not true then
    raise exception 'TEST 230 FAILED: % booking=% rows=%', r, row_to_json(b), n;
  end if;
  raise notice 'TEST 230 PASS  typed-in stay adopted and moved to Airbnb''s dates, no clash';

  -- TEST 231 - a direct booking in the way is never taken: still reported as a clash.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'confirmed', current_date + 480, current_date + 485, 2) returning id into v_direct;
  r := pg_temp.sync_as(pm, v_unit, pg_temp.feed(
    pg_temp.ev('ov-1@airbnb.com', 451, 458, 'reservation', 'HMOV1'),
    pg_temp.ev('ov-2@airbnb.com', 481, 484)));
  select * into b from bookings where id = v_direct;
  if b.check_in <> current_date + 480 or b.ical_uid is not null or (r->>'ok')::boolean is not false then
    raise exception 'TEST 231 FAILED: % direct=%', r, row_to_json(b);
  end if;
  raise notice 'TEST 231 PASS  a direct booking is not adopted; the clash is reported';
  delete from bookings where id = v_direct;

  -- TEST 232 - a reservation gone from the feed is cancelled even if a block now carries its UID.
  r := pg_temp.sync_as(pm, v_unit, pg_temp.feed(pg_temp.ev('ov-1@airbnb.com', 451, 458, 'blocked')));
  select * into b from bookings where id = v_typed;
  if b.status <> 'cancelled' then
    raise exception 'TEST 232 FAILED: % status=%', r, b.status;
  end if;
  raise notice 'TEST 232 PASS  only reservations keep a reservation alive';

  delete from availability_blocks where unit_id = v_unit and ical_uid like 'ov-%';
  delete from channel_feed_clashes where unit_id = v_unit and ical_uid like 'ov-%';
  delete from bookings where id = v_typed;
end $$;

select 'ALL ADOPT OVERLAPPING TESTS PASSED' as result;
