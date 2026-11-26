-- ============================================================================
-- D|R|P PMS - Special requests alarm (0079)
--
-- Runs after 02-41 (19 makes the housekeeping account). Reuses unit 2807 with
-- a stay far ahead of the other suites' and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/42_special_requests_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

-- Request rings the given person sees at hh:mm Dubai time on day d, as 'stage|note'.
create or replace function pg_temp.requests(who uuid, d date, hhmm time) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.act_as(who);
  select coalesce(string_agg(stage || '|' || coalesce(note, ''), ','), '') into v
    from due_stay_alarms((d + hhmm) at time zone 'Asia/Dubai')
   where kind = 'request';
  perform set_config('role', 'postgres', true);
  return v;
end $$;

-- Endpoints the scheduler would push a request ring to at hh:mm Dubai time on day d.
create or replace function pg_temp.pushes(d date, hhmm time) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('role', 'service_role', true);
  select coalesce(string_agg(endpoint, ',' order by endpoint), '') into v
    from stay_alarm_pushes((d + hhmm) at time zone 'Asia/Dubai')
   where kind = 'request';
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
  v_day date := current_date + 440;   -- the day before check-in
  v_bk uuid;
  v text;
begin
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults, children)
  values ('', v_unit, 'direct', 'confirmed', v_day + 1, v_day + 4, 2, 1) returning id into v_bk;
  insert into staff_property_assignments (profile_id, property_id)
  select hk, property_id from units where id = v_unit;
  perform pg_temp.act_as(admin);
  perform save_push_subscription('https://push.example/admin', 'k1', 'a1', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(hk);
  perform save_push_subscription('https://push.example/hk', 'k2', 'a2', 'Phone');
  perform set_config('role', 'postgres', true);

  -- TEST 420 - no requests, no ring.
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 420 FAILED: rings with no request'; end if;
  update bookings set special_requests = '   ' where id = v_bk;
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 420 FAILED: rings for blank request'; end if;
  raise notice 'TEST 420 PASS  no special requests, no ring';

  -- TEST 421 - from 10:00 the day before, super admins and housekeeping hear it, with the request.
  update bookings set special_requests = 'Crib. Spare sheets for 3 guests.' where id = v_bk;
  if pg_temp.requests(admin, v_day, '09:59') <> '' then raise exception 'TEST 421 FAILED: rings before 10:00'; end if;
  v := pg_temp.requests(admin, v_day, '10:00');
  if v <> '1|Crib. Spare sheets for 3 guests.' then raise exception 'TEST 421 FAILED: super admin gets %', v; end if;
  v := pg_temp.requests(hk, v_day, '10:00');
  if v <> '1|Crib. Spare sheets for 3 guests.' then raise exception 'TEST 421 FAILED: housekeeping gets %', v; end if;
  if pg_temp.requests(pm, v_day, '10:00') <> '' then raise exception 'TEST 421 FAILED: property manager hears it'; end if;
  v := pg_temp.pushes(v_day, '10:00');
  if v <> 'https://push.example/admin,https://push.example/hk' then raise exception 'TEST 421 FAILED: pushes go to %', v; end if;
  -- Two days ahead it is quiet.
  if pg_temp.requests(admin, v_day - 1, '12:00') <> '' then raise exception 'TEST 421 FAILED: rings two days ahead'; end if;
  raise notice 'TEST 421 PASS  10:00 the day before rings for super admins and housekeeping, saying the request';

  -- TEST 422 - the housekeeping prepare ring at 16:00 also says the request.
  perform pg_temp.act_as(hk);
  select note into v from due_stay_alarms((v_day + time '16:00') at time zone 'Asia/Dubai') where kind = 'prepare';
  perform set_config('role', 'postgres', true);
  if v is distinct from 'Crib. Spare sheets for 3 guests.' then raise exception 'TEST 422 FAILED: prepare ring says %', v; end if;
  raise notice 'TEST 422 PASS  the get-ready ring names the request too';

  -- TEST 423 - it keeps ringing (check-in day too) until Done, which records who pressed it.
  if pg_temp.requests(admin, v_day + 1, '08:00') = '' then raise exception 'TEST 423 FAILED: quiet on check-in day'; end if;
  perform pg_temp.act_as(hk);
  perform ack_stay_alarm(v_bk, 'request', 1::smallint);
  perform set_config('role', 'postgres', true);
  if pg_temp.requests(admin, v_day, '23:00') <> '' then raise exception 'TEST 423 FAILED: still rings after Done'; end if;
  if pg_temp.pushes(v_day + 1, '08:00') <> '' then raise exception 'TEST 423 FAILED: still pushed after Done'; end if;
  if (select special_requests_done_by from bookings where id = v_bk) is distinct from hk
     or (select special_requests_done_at from bookings where id = v_bk) is null then
    raise exception 'TEST 423 FAILED: Done not recorded';
  end if;
  raise notice 'TEST 423 PASS  Done stops it and records who pressed it';

  -- TEST 424 - changing the request makes it ring again; an unrelated edit does not.
  update bookings set adults = 3 where id = v_bk;
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 424 FAILED: other edit re-rings'; end if;
  update bookings set special_requests = 'Crib, spare sheets, high chair' where id = v_bk;
  if (select special_requests_done_at from bookings where id = v_bk) is not null then
    raise exception 'TEST 424 FAILED: Done kept after change';
  end if;
  if pg_temp.requests(admin, v_day, '12:00') <> '1|Crib, spare sheets, high chair' then
    raise exception 'TEST 424 FAILED: changed request does not ring';
  end if;
  raise notice 'TEST 424 PASS  a changed request rings again';

  -- TEST 425 - a request added on check-in day rings at once; none for tentative, cancelled or alarms off.
  if pg_temp.requests(admin, v_day + 1, '00:05') = '' then raise exception 'TEST 425 FAILED: quiet early on check-in day'; end if;
  update profiles set alarms_off = true where id = admin;
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 425 FAILED: alarms off still rings'; end if;
  if pg_temp.pushes(v_day, '12:00') <> 'https://push.example/hk' then raise exception 'TEST 425 FAILED: alarms off still pushed'; end if;
  update profiles set alarms_off = false where id = admin;
  update bookings set status = 'tentative' where id = v_bk;
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 425 FAILED: tentative stay rings'; end if;
  update bookings set status = 'cancelled', cancelled_on = current_date where id = v_bk;
  if pg_temp.requests(admin, v_day, '12:00') <> '' then raise exception 'TEST 425 FAILED: cancelled stay rings'; end if;
  raise notice 'TEST 425 PASS  late requests ring at once; none for tentative, cancelled or alarms off';

  delete from push_subscriptions where endpoint like 'https://push.example/%';
  delete from staff_property_assignments where profile_id = hk;
  delete from bookings where id = v_bk;
end $$;

select 'ALL SPECIAL REQUEST TESTS PASSED' as result;
