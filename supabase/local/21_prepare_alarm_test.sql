-- ============================================================================
-- D|R|P PMS - Alarm the day before check-in, for housekeeping (0044)
--
-- Runs after 02-20 (19 makes the housekeeping account). Reuses unit 2807 with
-- stays far ahead of the other suites' and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/21_prepare_alarm_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

-- Rings the given person sees at hh:mm Dubai time on day d, as 'kind:stage' text.
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

-- Endpoints the scheduler would push to at hh:mm Dubai time on day d.
create or replace function pg_temp.pushes(d date, hhmm time) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('role', 'service_role', true);
  select coalesce(string_agg(endpoint || '>' || kind || ':' || stage, ',' order by endpoint, kind), '') into v
    from stay_alarm_pushes((d + hhmm) at time zone 'Asia/Dubai');
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
  v_day date := current_date + 420;   -- the day before check-in
  v_bk uuid;
  v text;
begin
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', v_day + 1, v_day + 4, 2) returning id into v_bk;
  insert into staff_property_assignments (profile_id, property_id)
  select hk, property_id from units where id = v_unit;
  perform pg_temp.act_as(admin);
  perform save_push_subscription('https://push.example/admin', 'k1', 'a1', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(hk);
  perform save_push_subscription('https://push.example/hk', 'k2', 'a2', 'Phone');
  perform set_config('role', 'postgres', true);

  -- TEST 210 - from 16:00 the day before, housekeeping hears it; nobody else.
  if pg_temp.rings(hk, v_day, '15:59') <> '' then raise exception 'TEST 210 FAILED: rings before 16:00'; end if;
  v := pg_temp.rings(hk, v_day, '16:00');
  if v <> 'prepare:1' then raise exception 'TEST 210 FAILED: housekeeping at 16:00 gets %', v; end if;
  if pg_temp.rings(admin, v_day, '16:00') <> '' then raise exception 'TEST 210 FAILED: super admin hears it'; end if;
  if pg_temp.rings(pm, v_day, '16:00') <> '' then raise exception 'TEST 210 FAILED: property manager hears it'; end if;
  v := pg_temp.pushes(v_day, '18:00');
  if v <> 'https://push.example/hk>prepare:1' then raise exception 'TEST 210 FAILED: pushes go to %', v; end if;
  raise notice 'TEST 210 PASS  16:00 the day before check-in rings for housekeeping only';

  -- TEST 211 - it keeps ringing until Done, then stops; check-in day rings as before.
  if pg_temp.rings(hk, v_day, '23:00') <> 'prepare:1' then raise exception 'TEST 211 FAILED: stopped by itself'; end if;
  perform pg_temp.act_as(hk);
  perform ack_stay_alarm(v_bk, 'prepare', 1::smallint);
  perform set_config('role', 'postgres', true);
  if pg_temp.rings(hk, v_day, '23:00') <> '' then raise exception 'TEST 211 FAILED: still rings after Done'; end if;
  if pg_temp.pushes(v_day, '23:00') <> '' then raise exception 'TEST 211 FAILED: still pushed after Done'; end if;
  if (select prepare_alarm_done_by from bookings where id = v_bk) is distinct from hk then
    raise exception 'TEST 211 FAILED: Done not recorded';
  end if;
  v := pg_temp.rings(admin, v_day + 1, '14:00');
  if v <> 'check_in:1' then raise exception 'TEST 211 FAILED: check-in day gives %', v; end if;
  raise notice 'TEST 211 PASS  Done stops it and records who pressed it; check-in day is unchanged';

  -- TEST 212 - no ring for a tentative or cancelled stay.
  update bookings set prepare_alarm_done = 0, status = 'tentative' where id = v_bk;
  if pg_temp.rings(hk, v_day, '16:00') <> '' then raise exception 'TEST 212 FAILED: tentative stay rings'; end if;
  update bookings set status = 'cancelled', cancelled_on = current_date where id = v_bk;
  if pg_temp.rings(hk, v_day, '16:00') <> '' then raise exception 'TEST 212 FAILED: cancelled stay rings'; end if;
  raise notice 'TEST 212 PASS  no ring for tentative or cancelled stays';

  delete from push_subscriptions where endpoint like 'https://push.example/%';
  delete from staff_property_assignments where profile_id = hk;
  delete from bookings where id = v_bk;
end $$;

select 'ALL PREPARE ALARM TESTS PASSED' as result;
