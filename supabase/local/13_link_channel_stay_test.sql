-- ============================================================================
-- D|R|P PMS - Linking a channel stay to a booking already in the portal (0036)
--
-- Runs after 02-12 and reuses unit 2807 (valid DET permit, property manager
-- assigned, owner B). Dates are far ahead and everything is removed after.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/13_link_channel_stay_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.res(uid text, s integer, e integer, code text) returns jsonb
language sql as $$
  select jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e, 'kind', 'reservation', 'code', code)
$$;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  v_bk   uuid;
  r jsonb;
  n integer;
begin
  -- A private guest's stay, typed in by hand: nights 400-440.
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 400, current_date + 440, 1)
  returning id into v_bk;

  -- TEST 100 - Airbnb's two reservations for the same guest clash, and the
  -- clash is recorded with the booking in the way.
  r := apply_channel_ical(v_unit, 'airbnb', jsonb_build_array(
         pg_temp.res('link-a@airbnb.com', 405, 420, 'HMLINKAAA1'),
         pg_temp.res('link-b@airbnb.com', 420, 450, 'HMLINKBBB2')));
  select count(*) into n from channel_feed_clashes where unit_id = v_unit and booking_id = v_bk;
  if n <> 2 or (r->>'ok')::boolean then raise exception 'TEST 100 FAILED: % clashes, %', n, r; end if;
  raise notice 'TEST 100 PASS  both clashing Airbnb stays recorded against the booking';

  -- TEST 101 - an owner cannot link them.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  begin
    perform link_channel_stay(v_unit, 'airbnb', 'link-a@airbnb.com', v_bk);
    raise exception 'TEST 101 FAILED: owner linked a stay';
  exception when check_violation or insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from channel_stay_links where ical_uid = 'link-a@airbnb.com') then
    raise exception 'TEST 101 FAILED: link written for the owner';
  end if;
  raise notice 'TEST 101 PASS  owners cannot link channel stays';

  -- TEST 102 - staff link both; the next read imports neither and is clean.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform link_channel_stay(v_unit, 'airbnb', 'link-a@airbnb.com', v_bk);
  perform link_channel_stay(v_unit, 'airbnb', 'link-b@airbnb.com', v_bk);
  perform set_config('role', 'postgres', true);
  r := apply_channel_ical(v_unit, 'airbnb', jsonb_build_array(
         pg_temp.res('link-a@airbnb.com', 405, 420, 'HMLINKAAA1'),
         pg_temp.res('link-b@airbnb.com', 420, 450, 'HMLINKBBB2')));
  if not (r->>'ok')::boolean or (r->>'created')::int <> 0
     or exists (select 1 from channel_feed_clashes where unit_id = v_unit)
     or exists (select 1 from bookings where ical_uid like 'link-%@airbnb.com') then
    raise exception 'TEST 102 FAILED: %', r;
  end if;
  raise notice 'TEST 102 PASS  linked stays are skipped: no import, no clash, sync ok';

  -- TEST 103 - a booking on another unit cannot be linked.
  begin
    perform link_channel_stay((select id from units where unit_number = '1204'), 'airbnb', 'link-a@airbnb.com', v_bk);
    raise exception 'TEST 103 FAILED: linked to a booking on another unit';
  exception when check_violation then null;
  end;
  raise notice 'TEST 103 PASS  only a booking on the same unit can be linked';

  -- TEST 104 - deleting the booking drops the links; the stays come back.
  delete from bookings where id = v_bk;
  r := apply_channel_ical(v_unit, 'airbnb', jsonb_build_array(
         pg_temp.res('link-a@airbnb.com', 405, 420, 'HMLINKAAA1'),
         pg_temp.res('link-b@airbnb.com', 420, 450, 'HMLINKBBB2')));
  select count(*) into n from bookings where ical_uid like 'link-%@airbnb.com' and status = 'confirmed';
  if n <> 2 or exists (select 1 from channel_stay_links where unit_id = v_unit) then
    raise exception 'TEST 104 FAILED: % imported, %', n, r;
  end if;
  raise notice 'TEST 104 PASS  deleting the booking releases its linked stays to import';

  delete from bookings where ical_uid like 'link-%@airbnb.com';
  -- Leave the unit's Airbnb feed as the earlier suites expect: re-read it empty
  -- would cancel their stays, so only this suite's rows are removed.
end $$;

select 'ALL CHANNEL STAY LINK TESTS PASSED' as result;
