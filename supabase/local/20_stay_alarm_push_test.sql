-- ============================================================================
-- D|R|P PMS - Check-out / check-in alarm pushed to phones (0043)
--
-- Runs after 02-19 (19 makes the housekeeping account). Reuses unit 2807 with
-- stays far ahead of the other suites' and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/20_stay_alarm_push_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
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
  owner uuid := '33333333-3333-3333-3333-333333333333';
  hk    uuid := '99999999-9999-9999-9999-999999999999';
  v_unit uuid := (select id from units where unit_number = '2807');
  v_day date := current_date + 410;
  v_out uuid;
  v text;
  n integer;
begin
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', v_day - 2, v_day, 2) returning id into v_out;

  -- TEST 200 - staff save their device; others cannot; nobody reads the table.
  perform pg_temp.act_as(admin);
  perform save_push_subscription('https://push.example/admin', 'k1', 'a1', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(hk);
  perform save_push_subscription('https://push.example/hk', 'k2', 'a2', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(pm);
  perform save_push_subscription('https://push.example/pm', 'k3', 'a3', 'Phone');
  perform set_config('role', 'postgres', true);
  -- Owners save devices too since 0051 (their notifications), but never get the alarm.
  perform pg_temp.act_as(owner);
  perform save_push_subscription('https://push.example/owner', 'k4', 'a4', 'Phone');
  perform set_config('role', 'postgres', true);
  perform pg_temp.act_as(admin);
  begin
    select count(*) into n from push_subscriptions;
    raise exception 'TEST 200 FAILED: staff read push_subscriptions';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from push_vapid_keys;
    raise exception 'TEST 200 FAILED: staff read push_vapid_keys';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from stay_alarm_pushes();
    raise exception 'TEST 200 FAILED: staff called stay_alarm_pushes';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  raise notice 'TEST 200 PASS  staff and owners save their phone; only the server reads them';

  -- TEST 201 - each ring goes to the super admin and the unit's housekeeping only.
  if pg_temp.pushes(v_day, '10:59') <> '' then raise exception 'TEST 201 FAILED: pushes before 11:00'; end if;
  v := pg_temp.pushes(v_day, '11:00');
  if v <> 'https://push.example/admin>check_out:1' then raise exception 'TEST 201 FAILED: unassigned gives %', v; end if;
  insert into staff_property_assignments (profile_id, property_id)
  select hk, property_id from units where id = v_unit;
  v := pg_temp.pushes(v_day, '12:00');
  if v <> 'https://push.example/admin>check_out:2,https://push.example/hk>check_out:2' then
    raise exception 'TEST 201 FAILED: assigned gives %', v;
  end if;
  update profiles set is_active = false where id = hk;
  v := pg_temp.pushes(v_day, '12:00');
  update profiles set is_active = true where id = hk;
  if v <> 'https://push.example/admin>check_out:2' then raise exception 'TEST 201 FAILED: deactivated gives %', v; end if;
  raise notice 'TEST 201 PASS  pushed to the super admin and the unit''s active housekeeping';

  -- TEST 202 - "Done" stops the pushes; a device moves with whoever signs in.
  perform pg_temp.act_as(hk);
  perform ack_stay_alarm(v_out, 'check_out', 2::smallint);
  perform set_config('role', 'postgres', true);
  if pg_temp.pushes(v_day, '12:30') <> '' then raise exception 'TEST 202 FAILED: pushes after Done'; end if;
  perform pg_temp.act_as(pm);
  perform save_push_subscription('https://push.example/hk', 'k5', 'a5', 'Phone');
  perform set_config('role', 'postgres', true);
  if (select profile_id from push_subscriptions where endpoint = 'https://push.example/hk') <> pm then
    raise exception 'TEST 202 FAILED: device did not move to the new sign-in';
  end if;
  perform pg_temp.act_as(admin);
  perform delete_push_subscription('https://push.example/pm');  -- not theirs: no effect
  perform delete_push_subscription('https://push.example/admin');
  perform set_config('role', 'postgres', true);
  if (select count(*) from push_subscriptions where endpoint = 'https://push.example/pm') <> 1
     or (select count(*) from push_subscriptions where endpoint = 'https://push.example/admin') <> 0 then
    raise exception 'TEST 202 FAILED: delete';
  end if;
  raise notice 'TEST 202 PASS  Done stops the pushes; people remove only their own devices';

  delete from push_subscriptions where endpoint like 'https://push.example/%';
  delete from staff_property_assignments where profile_id = hk;
  delete from bookings where id = v_out;
end $$;

select 'ALL STAY ALARM PUSH TESTS PASSED' as result;
