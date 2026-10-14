-- ============================================================================
-- D|R|P PMS - Alarm for website bookings to block on Airbnb (0037)
--
-- Runs after 02-13 and reuses unit 2807 (valid DET permit). Its dates sit far
-- ahead of the other suites' and it removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/14_airbnb_block_alarm_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  v_old_url text := (select airbnb_ical_url from units where unit_number = '2807');
  v_bk uuid;
  n integer;
begin
  update units set airbnb_ical_url = 'https://www.airbnb.com/calendar/ical/1.ics' where id = v_unit;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults, website_ref)
  values ('', v_unit, 'direct', 'confirmed', current_date + 500, current_date + 505, 2, 'WEB-ALARM-1')
  returning id into v_bk;

  -- TEST 110 - the super admin's alarm lists it; the property manager's does not.
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'TEST 110 FAILED: super admin sees % alarms', n; end if;
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  select count(*) into n from pending_airbnb_blocks();
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'TEST 110 FAILED: property manager sees % alarms', n; end if;
  raise notice 'TEST 110 PASS  new website booking alarms the super admin only';

  -- TEST 111 - only a super admin can mark it done.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  begin
    perform mark_airbnb_blocked(v_bk);
    raise exception 'TEST 111 FAILED: property manager marked it done';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  perform mark_airbnb_blocked(v_bk);
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  perform set_config('role', 'postgres', true);
  if n <> 0 or (select airbnb_block_done_by from bookings where id = v_bk) is distinct from '11111111-1111-1111-1111-111111111111' then
    raise exception 'TEST 111 FAILED: still pending after done';
  end if;
  raise notice 'TEST 111 PASS  super admin marks it blocked; the alarm stops';

  -- TEST 112 - no alarm for a cancelled website booking, or a unit not on Airbnb.
  update bookings set airbnb_block_done_at = null, status = 'cancelled', cancelled_on = current_date where id = v_bk;
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'TEST 112 FAILED: cancelled booking alarms'; end if;
  update bookings set status = 'confirmed', cancelled_on = null where id = v_bk;
  update units set airbnb_ical_url = null where id = v_unit;
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'TEST 112 FAILED: unit without Airbnb alarms'; end if;
  raise notice 'TEST 112 PASS  no alarm when cancelled or the unit is not on Airbnb';

  delete from bookings where id = v_bk;
  update units set airbnb_ical_url = v_old_url where id = v_unit;
end $$;

select 'ALL AIRBNB BLOCK ALARM TESTS PASSED' as result;
