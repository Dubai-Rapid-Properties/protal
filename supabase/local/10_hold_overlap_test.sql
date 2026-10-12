-- ============================================================================
-- D|R|P PMS - No booking over an owner stay, no hold over a booking (0032)
--
-- Runs after 02-09 and reuses unit 2807 (owner B, valid DET permit). Its
-- dates sit far ahead of the other suites' fixtures, and it removes what it
-- adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/10_hold_overlap_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_unit  uuid := (select id from units where unit_number = '2807');
  v_hold  uuid;
  v_bk    uuid;
  v_old   uuid;
  r       jsonb;
  d0      date := current_date + 200;
begin
  -- The permit has to cover these dates for any booking to be accepted.
  update holiday_home_permits set expires_on = current_date + 500, status = 'active'
   where unit_id = v_unit;

  -- An owner stay, d0+10 to d0+20.
  insert into availability_blocks (unit_id, start_date, end_date, reason)
  values (v_unit, d0 + 10, d0 + 20, 'owner_stay') returning id into v_hold;

  -- TEST 70 - a confirmed booking inside the owner stay is refused.
  begin
    insert into bookings (unit_id, channel, status, check_in, check_out, adults)
    values (v_unit, 'direct', 'confirmed', d0 + 15, d0 + 18, 2);
    raise exception 'TEST 70 FAILED: booking over an owner stay accepted';
  exception when check_violation then
    if sqlerrm not like 'These dates overlap an owner stay%' then
      raise exception 'TEST 70 FAILED: unexpected message %', sqlerrm;
    end if;
    raise notice 'TEST 70 PASS  booking over an owner stay refused: %', sqlerrm;
  end;

  -- TEST 71 - check-out on the owner's arrival day, and check-in on their
  -- departure day, are both fine (half-open ranges).
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'confirmed', d0 + 5, d0 + 10, 2) returning id into v_bk;
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'confirmed', d0 + 20, d0 + 22, 2);
  raise notice 'TEST 71 PASS  same-day turnarounds either side of an owner stay allowed';

  -- TEST 72 - moving a booking into the owner stay is refused.
  begin
    update bookings set check_out = d0 + 12 where id = v_bk;
    raise exception 'TEST 72 FAILED: booking moved into an owner stay';
  exception when check_violation then
    raise notice 'TEST 72 PASS  moving a booking into an owner stay refused';
  end;

  -- TEST 73 - an inquiry may sit there, but confirming it is refused.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'inquiry', d0 + 12, d0 + 14, 2) returning id into v_old;
  begin
    update bookings set status = 'confirmed' where id = v_old;
    raise exception 'TEST 73 FAILED: inquiry confirmed over an owner stay';
  exception when check_violation then
    raise notice 'TEST 73 PASS  confirming a request over an owner stay refused';
  end;
  delete from bookings where id = v_old;

  -- TEST 74 - an owner stay over a live booking is refused, with its number.
  begin
    insert into availability_blocks (unit_id, start_date, end_date, reason)
    values (v_unit, d0 + 3, d0 + 7, 'owner_stay');
    raise exception 'TEST 74 FAILED: owner stay over a booking accepted';
  exception when check_violation then
    if sqlerrm not like 'Booking % is in these dates%' then
      raise exception 'TEST 74 FAILED: unexpected message %', sqlerrm;
    end if;
    raise notice 'TEST 74 PASS  owner stay over a booking refused: %', sqlerrm;
  end;

  -- TEST 75 - so is stretching an existing owner stay over it.
  begin
    update availability_blocks set start_date = d0 + 8 where id = v_hold;
    raise exception 'TEST 75 FAILED: owner stay stretched over a booking';
  exception when check_violation then
    raise notice 'TEST 75 PASS  stretching an owner stay over a booking refused';
  end;

  -- TEST 76 - a channel block (dates closed on Airbnb) still takes a direct
  -- booking: D|R|P closes Airbnb for its own guests.
  insert into availability_blocks (unit_id, start_date, end_date, reason, source_channel)
  values (v_unit, d0 + 30, d0 + 35, 'channel_sync', 'airbnb');
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'direct', 'confirmed', d0 + 31, d0 + 33, 2);
  raise notice 'TEST 76 PASS  direct booking inside dates closed on Airbnb allowed';

  -- TEST 77 - an Airbnb feed stay over the owner stay is not imported; the
  -- sync names the owner stay and keeps the rest of the feed.
  r := apply_channel_ical(v_unit, 'airbnb', jsonb_build_array(
    jsonb_build_object('uid', 'clash-1@airbnb.com', 'start', d0 + 14, 'end', d0 + 16, 'kind', 'reservation', 'code', 'HMCLASH001'),
    jsonb_build_object('uid', 'fine-1@airbnb.com', 'start', d0 + 40, 'end', d0 + 42, 'kind', 'reservation', 'code', 'HMFINE0001')));
  if exists (select 1 from bookings where ical_uid = 'clash-1@airbnb.com')
     or not exists (select 1 from bookings where ical_uid = 'fine-1@airbnb.com')
     or r::text not like '%overlap an owner stay%' then
    raise exception 'TEST 77 FAILED: %', r;
  end if;
  raise notice 'TEST 77 PASS  Airbnb stay over an owner stay not imported and reported';

  -- TEST 78 - a stay that overlapped before 0032 can still be checked in.
  alter table bookings disable trigger bookings_hold_gate;
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_unit, 'airbnb', 'confirmed', d0 + 11, d0 + 13, 2) returning id into v_old;
  alter table bookings enable trigger bookings_hold_gate;
  update bookings set status = 'checked_in' where id = v_old;
  update bookings set status = 'cancelled', cancelled_on = current_date where id = v_old;
  raise notice 'TEST 78 PASS  an existing overlap can still be checked in and cancelled';

  -- Clean up: leave the unit as the other suites found it.
  delete from bookings where unit_id = v_unit and check_in >= d0;
  delete from availability_blocks where unit_id = v_unit and start_date >= d0;
end $$;

select 'ALL HOLD OVERLAP TESTS PASSED' as result;
