-- ============================================================================
-- D|R|P PMS - Alarm for today's check-outs and check-ins (0042)
--
-- Runs after 02-18 and reuses unit 2807. Its stays sit far ahead of the other
-- suites' (the moment is passed to due_stay_alarms) and it removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/19_stay_alarm_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

-- Alarms the given person sees at hh:mm Dubai time on day d, as 'kind:stage' text.
create or replace function pg_temp.rings(who uuid, d date, hhmm time) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.act_as(who);
  select coalesce(string_agg(kind || ':' || stage, ',' order by kind), '') into v
    from due_stay_alarms((d + hhmm) at time zone 'Asia/Dubai');
  perform set_config('role', 'postgres', true);
  return v;
end $$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('99999999-9999-9999-9999-999999999999', 'housekeeping@drp.ae',
   '{"full_name":"Housekeeping Manager"}', '{"role":"maintenance"}')
on conflict (id) do nothing;
update profiles set role = 'maintenance' where id = '99999999-9999-9999-9999-999999999999';

do $$
declare
  admin uuid := '11111111-1111-1111-1111-111111111111';
  pm    uuid := '22222222-2222-2222-2222-222222222222';
  hk    uuid := '99999999-9999-9999-9999-999999999999';
  v_unit uuid := (select id from units where unit_number = '2807');
  v_day date := current_date + 400;
  v_out uuid;
  v_in uuid;
  v text;
begin
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'checked_in', v_day - 3, v_day, 2) returning id into v_out;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', v_day, v_day + 2, 2) returning id into v_in;

  -- TEST 190 - an hour ahead and on the time, for check-out then check-in.
  if pg_temp.rings(admin, v_day, '10:59') <> '' then raise exception 'TEST 190 FAILED: rings before 11:00'; end if;
  v := pg_temp.rings(admin, v_day, '11:00');
  if v <> 'check_out:1' then raise exception 'TEST 190 FAILED: 11:00 gives %', v; end if;
  v := pg_temp.rings(admin, v_day, '12:00');
  if v <> 'check_out:2' then raise exception 'TEST 190 FAILED: 12:00 gives %', v; end if;
  v := pg_temp.rings(admin, v_day, '14:00');
  if v <> 'check_in:1,check_out:2' then raise exception 'TEST 190 FAILED: 14:00 gives %', v; end if;
  v := pg_temp.rings(admin, v_day, '15:00');
  if v <> 'check_in:2,check_out:2' then raise exception 'TEST 190 FAILED: 15:00 gives %', v; end if;
  if pg_temp.rings(admin, v_day - 1, '15:00') <> '' then raise exception 'TEST 190 FAILED: rings the day before'; end if;
  raise notice 'TEST 190 PASS  check-out rings 11:00 and 12:00, check-in 14:00 and 15:00';

  -- TEST 191 - super admin and assigned housekeeping only.
  if pg_temp.rings(pm, v_day, '15:00') <> '' then raise exception 'TEST 191 FAILED: property manager hears it'; end if;
  if pg_temp.rings(hk, v_day, '15:00') <> '' then raise exception 'TEST 191 FAILED: unassigned housekeeping hears it'; end if;
  perform pg_temp.act_as(hk);
  begin
    perform ack_stay_alarm(v_out, 'check_out', 1::smallint);
    raise exception 'TEST 191 FAILED: unassigned housekeeping answered it';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  insert into staff_unit_assignments (profile_id, unit_id) values (hk, v_unit);
  v := pg_temp.rings(hk, v_day, '15:00');
  if v <> 'check_in:2,check_out:2' then raise exception 'TEST 191 FAILED: assigned housekeeping gets %', v; end if;
  raise notice 'TEST 191 PASS  super admin and the unit''s housekeeping hear it; no one else';

  -- TEST 192 - "Done" stops a ring; the next ring still sounds.
  perform pg_temp.act_as(hk);
  perform ack_stay_alarm(v_out, 'check_out', 1::smallint);
  perform set_config('role', 'postgres', true);
  if pg_temp.rings(admin, v_day, '11:30') <> '' then raise exception 'TEST 192 FAILED: 11:00 ring still sounds'; end if;
  v := pg_temp.rings(admin, v_day, '12:00');
  if v <> 'check_out:2' then raise exception 'TEST 192 FAILED: 12:00 after done-1 gives %', v; end if;
  perform pg_temp.act_as(admin);
  perform ack_stay_alarm(v_out, 'check_out', 2::smallint);
  perform ack_stay_alarm(v_out, 'check_out', 1::smallint);  -- a late click on the old ring
  perform ack_stay_alarm(v_in, 'check_in', 2::smallint);    -- answered on the time, skips the first
  perform set_config('role', 'postgres', true);
  if pg_temp.rings(admin, v_day, '16:00') <> '' then raise exception 'TEST 192 FAILED: still ringing after done'; end if;
  if (select check_out_alarm_done from bookings where id = v_out) <> 2
     or (select check_out_alarm_done_by from bookings where id = v_out) is distinct from admin then
    raise exception 'TEST 192 FAILED: done not recorded';
  end if;
  raise notice 'TEST 192 PASS  Done stops each ring and records who pressed it';

  -- TEST 193 - no ring for a cancelled or tentative stay.
  update bookings set check_in_alarm_done = 0, status = 'cancelled', cancelled_on = current_date where id = v_in;
  if pg_temp.rings(admin, v_day, '15:00') <> '' then raise exception 'TEST 193 FAILED: cancelled stay rings'; end if;
  update bookings set status = 'tentative', cancelled_on = null where id = v_in;
  if pg_temp.rings(admin, v_day, '15:00') <> '' then raise exception 'TEST 193 FAILED: tentative stay rings'; end if;
  raise notice 'TEST 193 PASS  no ring for cancelled or tentative stays';

  delete from staff_unit_assignments where profile_id = hk;
  delete from bookings where id in (v_out, v_in);
end $$;

select 'ALL STAY ALARM TESTS PASSED' as result;
