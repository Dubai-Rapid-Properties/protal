-- ============================================================================
-- D|R|P PMS - Early check-in and late check-out (0048)
--
-- Runs after 02-24. Uses unit 2807 with stays far ahead of the other suites'
-- and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/25_stay_times_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.at(d date, t text) returns timestamptz
language sql as $$ select (d + t::time) at time zone 'Asia/Dubai' $$;

create or replace function pg_temp.ring(b uuid, k text, p timestamptz) returns smallint
language sql as $$ select stage from pms.due_stay_rings(p) where booking_id = b and kind = k $$;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  d_in date := current_date + 470;
  d_out date := current_date + 474;
  v_early uuid;
  v_plain uuid;
  t housekeeping_tasks%rowtype;
begin
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, check_in_time, check_out_time)
  values (v_unit, 'direct', 'confirmed', d_in, d_out, 2, '10:00', '16:00') returning id into v_early;
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'confirmed', d_out + 5, d_out + 8, 2) returning id into v_plain;

  -- TEST 250 - an early check-in rings an hour ahead of and at its own time.
  if pg_temp.ring(v_early, 'check_in', pg_temp.at(d_in, '08:30')) is not null
     or pg_temp.ring(v_early, 'check_in', pg_temp.at(d_in, '09:10')) <> 1
     or pg_temp.ring(v_early, 'check_in', pg_temp.at(d_in, '10:05')) <> 2 then
    raise exception 'TEST 250 FAILED';
  end if;
  raise notice 'TEST 250 PASS  early check-in rings at 09:00 and 10:00';

  -- TEST 251 - a late check-out does not ring at noon, but an hour before its time.
  if pg_temp.ring(v_early, 'check_out', pg_temp.at(d_out, '12:30')) is not null
     or pg_temp.ring(v_early, 'check_out', pg_temp.at(d_out, '15:10')) <> 1
     or pg_temp.ring(v_early, 'check_out', pg_temp.at(d_out, '16:00')) <> 2 then
    raise exception 'TEST 251 FAILED';
  end if;
  raise notice 'TEST 251 PASS  late check-out rings at 15:00 and 16:00, not at noon';

  -- TEST 252 - a stay without times keeps the standard 14:00 / 15:00 and 11:00 / 12:00.
  if pg_temp.ring(v_plain, 'check_in', pg_temp.at(d_out + 5, '13:59')) is not null
     or pg_temp.ring(v_plain, 'check_in', pg_temp.at(d_out + 5, '14:00')) <> 1
     or pg_temp.ring(v_plain, 'check_out', pg_temp.at(d_out + 8, '12:00')) <> 2
     or to_char(pms.stay_time('check_in', null, null), 'HH24:MI') <> '15:00' then
    raise exception 'TEST 252 FAILED';
  end if;
  raise notice 'TEST 252 PASS  standard times unchanged';

  -- TEST 253 - the turnover clean starts at the late check-out and follows changes.
  select * into t from housekeeping_tasks where booking_id = v_early and kind = 'turnover';
  if t.scheduled_start <> pg_temp.at(d_out, '16:00') then
    raise exception 'TEST 253 FAILED (created): %', t.scheduled_start;
  end if;
  update bookings set check_out_time = null where id = v_early;
  select * into t from housekeeping_tasks where booking_id = v_early and kind = 'turnover';
  if t.scheduled_start <> pg_temp.at(d_out, '11:00') then
    raise exception 'TEST 253 FAILED (standard): %', t.scheduled_start;
  end if;
  update bookings set check_out = d_out + 1, check_out_time = '13:00' where id = v_early;
  select * into t from housekeeping_tasks where booking_id = v_early and kind = 'turnover';
  if t.scheduled_start <> pg_temp.at(d_out + 1, '13:00') then
    raise exception 'TEST 253 FAILED (moved): %', t.scheduled_start;
  end if;
  raise notice 'TEST 253 PASS  the clean follows the check-out day and time';

  delete from housekeeping_tasks where booking_id in (v_early, v_plain);
  delete from bookings where id in (v_early, v_plain);
end $$;
