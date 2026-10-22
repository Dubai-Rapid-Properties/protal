-- ============================================================================
-- D|R|P PMS - Accounts without alarms (0045)
--
-- Runs after 02-21. A second super admin with alarms_off hears nothing; the
-- first still hears everything. Reuses unit 2807 with stays far ahead of the
-- other suites' and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/22_alarms_off_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('88888888-8888-8888-8888-888888888888', 'boss@drp.ae', '{"full_name":"Boss"}', '{}')
on conflict (id) do nothing;
update profiles set role = 'super_admin', alarms_off = true where id = '88888888-8888-8888-8888-888888888888';

do $$
declare
  admin uuid := '11111111-1111-1111-1111-111111111111';
  boss  uuid := '88888888-8888-8888-8888-888888888888';
  v_unit uuid := (select id from units where unit_number = '2807');
  v_old_url text := (select airbnb_ical_url from units where unit_number = '2807');
  v_day date := current_date + 430;
  v_at timestamptz := ((current_date + 430) + time '15:00') at time zone 'Asia/Dubai';
  v_bk uuid;
  n integer;
begin
  update units set airbnb_ical_url = 'https://www.airbnb.com/calendar/ical/1.ics' where id = v_unit;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults, website_ref)
  values ('', v_unit, 'direct', 'confirmed', v_day, v_day + 3, 2, 'WEB-ALARMS-OFF') returning id into v_bk;
  perform pg_temp.act_as(admin);
  perform save_push_subscription('https://push.example/admin', 'k1', 'a1', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(boss);
  perform save_push_subscription('https://push.example/boss', 'k2', 'a2', 'Phone');
  perform set_config('role', 'postgres', true);

  -- TEST 220 - the account with alarms off hears no alarm; the other super admin does.
  perform pg_temp.act_as(boss);
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  if n <> 0 then raise exception 'TEST 220 FAILED: Airbnb alarm for alarms-off account'; end if;
  select count(*) into n from due_stay_alarms(v_at) where booking_id = v_bk;
  if n <> 0 then raise exception 'TEST 220 FAILED: check-in alarm for alarms-off account'; end if;
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(admin);
  select count(*) into n from pending_airbnb_blocks() where booking_id = v_bk;
  if n <> 1 then raise exception 'TEST 220 FAILED: other super admin lost the Airbnb alarm'; end if;
  select count(*) into n from due_stay_alarms(v_at) where booking_id = v_bk;
  if n <> 1 then raise exception 'TEST 220 FAILED: other super admin lost the check-in alarm'; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'TEST 220 PASS  alarms off: no Airbnb or check-in alarm; other super admins unchanged';

  -- TEST 221 - nothing is pushed to the alarms-off account's phone.
  perform set_config('role', 'service_role', true);
  select count(*) into n from stay_alarm_pushes(v_at) where endpoint = 'https://push.example/boss';
  if n <> 0 then raise exception 'TEST 221 FAILED: pushed to alarms-off account'; end if;
  select count(*) into n from stay_alarm_pushes(v_at) where endpoint = 'https://push.example/admin';
  if n <> 1 then raise exception 'TEST 221 FAILED: other super admin not pushed (%)', n; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'TEST 221 PASS  no phone alarms for the alarms-off account';

  delete from push_subscriptions where endpoint like 'https://push.example/%';
  delete from bookings where id = v_bk;
  update units set airbnb_ical_url = v_old_url where id = v_unit;
end $$;

delete from auth.users where id = '88888888-8888-8888-8888-888888888888';

select 'ALL ALARMS OFF TESTS PASSED' as result;
