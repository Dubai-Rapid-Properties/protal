-- ============================================================================
-- D|R|P PMS - Moving a stay to another unit; a cancelled stay that still pays (0047)
--
-- Runs after 02-23. Adds unit 2808 (owner C) next to 2807, uses stays far
-- ahead of the other suites' (and two in the past for the ledger), and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/24_move_stay_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.feed(variadic ev jsonb[]) returns jsonb
language sql as $$ select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(ev) x $$;

create or replace function pg_temp.ev(uid text, s integer, e integer, code text default null)
returns jsonb language sql as $$
  select jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e,
                            'kind', 'reservation', 'code', code)
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

create or replace function pg_temp.move_as(who uuid, booking uuid, unit uuid) returns text
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  perform move_booking(booking, unit);
  perform set_config('role', 'postgres', true);
  return 'ok';
exception when others then
  perform set_config('role', 'postgres', true);
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  pm uuid := '22222222-2222-2222-2222-222222222222';
  v_a uuid := (select id from units where unit_number = '2807');
  v_b uuid;
  v_owner_c uuid;
  v_stay uuid;
  v_other uuid;
  v_hold uuid;
  v_past uuid;
  v_kept uuid;
  r jsonb;
  t text;
  n integer;
  b bookings%rowtype;
  le ledger_entries%rowtype;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms,
                     size_sqft, furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, '2808', 'DRP-MG1-2808', 'apartment', 1, 1, 800, 'fully_furnished', 'short_term', 650, 3
    from units where id = v_a
  returning id into v_b;
  insert into owners (full_name, email) values ('Owner C', 'owner.c@example.com') returning id into v_owner_c;
  insert into unit_ownerships (unit_id, owner_id, ownership_pct) values (v_b, v_owner_c, 100);
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification,
                                    issued_on, expires_on, status)
  values (v_b, 'DET-HH-2026-24808', 'D|R|P Holiday Homes', 'Deluxe', current_date - 240, current_date + 500, 'active');

  -- An Airbnb stay on 2807, from its calendar.
  r := pg_temp.sync_as(pm, v_a, pg_temp.feed(pg_temp.ev('mv-1@airbnb.com', 460, 468, 'HMMOVE1')));
  select id into v_stay from bookings where unit_id = v_a and ical_uid = 'mv-1@airbnb.com';

  -- TEST 240 - the stay moves to 2808 with its hold; 2807's calendar links it.
  t := pg_temp.move_as(pm, v_stay, v_b);
  select * into b from bookings where id = v_stay;
  if t <> 'ok' or b.unit_id <> v_b or b.ical_uid is not null or b.external_booking_id <> 'HMMOVE1'
     or b.internal_notes not like '%Moved from Marina Gate 1 2807 to Marina Gate 1 2808%'
     or not exists (select 1 from channel_stay_links where unit_id = v_a and ical_uid = 'mv-1@airbnb.com' and booking_id = v_stay)
     or not exists (select 1 from availability_blocks where booking_id = v_stay and unit_id = v_b)
     or exists (select 1 from availability_blocks where booking_id = v_stay and unit_id = v_a) then
    raise exception 'TEST 240 FAILED: % booking=%', t, row_to_json(b);
  end if;
  raise notice 'TEST 240 PASS  stay moved with its hold; the old calendar links it';

  -- TEST 241 - neither calendar's sync touches it again.
  r := pg_temp.sync_as(pm, v_a, pg_temp.feed(pg_temp.ev('mv-1@airbnb.com', 460, 468, 'HMMOVE1')));
  select count(*) into n from bookings where unit_id = v_a and ical_uid = 'mv-1@airbnb.com';
  if n <> 0 or (r->>'ok')::boolean is not true then
    raise exception 'TEST 241 FAILED (old unit): % rows=%', r, n;
  end if;
  r := pg_temp.sync_as(pm, v_b, pg_temp.feed(pg_temp.ev('mv-9@airbnb.com', 490, 492)));
  select * into b from bookings where id = v_stay;
  if b.status <> 'confirmed' or b.check_in <> current_date + 460 or b.unit_id <> v_b then
    raise exception 'TEST 241 FAILED (new unit): % booking=%', r, row_to_json(b);
  end if;
  raise notice 'TEST 241 PASS  no re-import on the old unit, no cancellation on the new one';

  -- TEST 242 - a booking in the way on the other unit stops the move.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_a, 'direct', 'confirmed', current_date + 462, current_date + 465, 2) returning id into v_other;
  t := pg_temp.move_as(pm, v_stay, v_a);
  if t not like '23P01%' or (select unit_id from bookings where id = v_stay) <> v_b then
    raise exception 'TEST 242 FAILED: %', t;
  end if;
  raise notice 'TEST 242 PASS  overlapping booking on the target unit refuses the move';
  delete from bookings where id = v_other;

  -- TEST 243 - so does an owner stay.
  insert into availability_blocks (unit_id, start_date, end_date, reason)
  values (v_a, current_date + 466, current_date + 470, 'owner_stay') returning id into v_hold;
  t := pg_temp.move_as(pm, v_stay, v_a);
  if t not like '%blocked from%owner stay%' then
    raise exception 'TEST 243 FAILED: %', t;
  end if;
  raise notice 'TEST 243 PASS  owner stay on the target unit refuses the move';
  delete from availability_blocks where id = v_hold;

  -- TEST 244 - moved back, it is 2807's calendar stay again.
  t := pg_temp.move_as(pm, v_stay, v_a);
  select * into b from bookings where id = v_stay;
  r := pg_temp.sync_as(pm, v_a, pg_temp.feed(pg_temp.ev('mv-1@airbnb.com', 461, 468, 'HMMOVE1')));
  select count(*) into n from bookings where unit_id = v_a and status <> 'cancelled'
     and check_in between current_date + 455 and current_date + 470;
  if t <> 'ok' or b.ical_uid is distinct from 'mv-1@airbnb.com'
     or exists (select 1 from channel_stay_links where booking_id = v_stay)
     or n <> 1 or (select check_in from bookings where id = v_stay) <> current_date + 461 then
    raise exception 'TEST 244 FAILED: % % booking=% rows=%', t, r, row_to_json(b), n;
  end if;
  raise notice 'TEST 244 PASS  moved back: the feed UID returns and the sync follows it again';

  -- TEST 245 - a stay that already posted its income moves the line to the new owner.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_a, 'direct', 'confirmed', current_date - 9, current_date - 3, 2, 3000) returning id into v_past;
  perform post_completed_bookings();
  t := pg_temp.move_as(pm, v_past, v_b);
  perform post_completed_bookings();
  select * into le from ledger_entries where source_table = 'bookings' and source_id = v_past;
  if t <> 'ok' or le.unit_id <> v_b or le.owner_id <> v_owner_c or le.amount_aed <> 3000 then
    raise exception 'TEST 245 FAILED: % line=%', t, row_to_json(le);
  end if;
  raise notice 'TEST 245 PASS  the income line follows the stay to the new unit''s owner';

  -- TEST 246 - a cancelled stay whose payout is kept posts it; un-kept, the line goes.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults)
  values (v_b, 'airbnb', 'confirmed', current_date - 20, current_date - 12, 2) returning id into v_kept;
  update bookings set status = 'cancelled', cancelled_on = current_date - 25,
                      payout_kept = true, payout_expected_aed = 1800 where id = v_kept;
  perform post_completed_bookings();
  select * into le from ledger_entries where source_table = 'bookings' and source_id = v_kept;
  if le.id is null or le.amount_aed <> 1800 or le.owner_id <> v_owner_c
     or le.description not like 'Cancelled stay, payout kept %' then
    raise exception 'TEST 246 FAILED (kept): line=%', row_to_json(le);
  end if;
  update bookings set payout_kept = false where id = v_kept;
  perform post_completed_bookings();
  if exists (select 1 from ledger_entries where source_table = 'bookings' and source_id = v_kept) then
    raise exception 'TEST 246 FAILED: the line stayed after the payout was no longer kept';
  end if;
  raise notice 'TEST 246 PASS  a kept payout of a cancelled stay posts as income, and only while kept';

  delete from ledger_entries where source_table = 'bookings' and source_id in (v_past, v_kept);
  delete from housekeeping_tasks where booking_id in (v_stay, v_past, v_kept) or unit_id = v_b;
  delete from channel_stay_links where unit_id in (v_a, v_b) and ical_uid like 'mv-%';
  delete from availability_blocks where unit_id in (v_a, v_b) and (ical_uid like 'mv-%' or booking_id in (v_stay, v_past, v_kept));
  delete from bookings where id in (v_stay, v_past, v_kept) or unit_id = v_b;
  delete from holiday_home_permits where unit_id = v_b;
  delete from unit_ownerships where unit_id = v_b;
  delete from units where id = v_b;
  delete from owners where id = v_owner_c;
end $$;
