-- ============================================================================
-- D|R|P PMS - Guests moved to another apartment (0069)
--
-- Runs after 02. Uses unit 2807 (valid DET permit) and adds a second
-- short-term unit; dates are far ahead of the other suites' stays and
-- relative to today. Removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/33_moved_channel_stays_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.feed(variadic ev jsonb[]) returns jsonb
language sql as $$ select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(ev) x $$;

create or replace function pg_temp.ev(uid text, s integer, e integer)
returns jsonb language sql as $$
  select jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e, 'kind', 'reservation')
$$;

do $$
declare
  v_from uuid := (select id from units where unit_number = '2807');
  v_to   uuid;
  v_b    bookings%rowtype;
  n      integer;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms, size_sqft,
                     furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, 'MV-1', 'DRP-MV-1', 'apartment', 1, 1, 700, 'fully_furnished', 'short_term', 600, 2
    from units where id = v_from
  returning id into v_to;
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification,
                                    issued_on, expires_on, status)
  values (v_to, 'DET-HH-MV-1', 'D|R|P Holiday Homes', 'Standard', current_date - 10, current_date + 900, 'active');

  -- The Airbnb stay arrives on the apartment it was booked for...
  perform apply_airbnb_ical(v_from, pg_temp.feed(pg_temp.ev('mv-1@airbnb.com', 400, 404)));
  -- ...and the bookings sheet moves the guest to MV-1.
  update bookings set unit_id = v_to, moved_from_unit_id = v_from where ical_uid = 'mv-1@airbnb.com';

  -- TEST 330 - the original apartment's feed still owns the stay: Airbnb's new dates reach it, no duplicate.
  perform apply_airbnb_ical(v_from, pg_temp.feed(pg_temp.ev('mv-1@airbnb.com', 400, 405), pg_temp.ev('mv-2@airbnb.com', 420, 422)));
  select * into v_b from bookings where ical_uid = 'mv-1@airbnb.com' and status <> 'cancelled';
  select count(*) into n from bookings where ical_uid = 'mv-1@airbnb.com';
  if n <> 1 or v_b.unit_id <> v_to or v_b.check_out <> current_date + 405 then
    raise exception 'TEST 330 FAILED: % bookings, on % to %', n, v_b.unit_id, v_b.check_out;
  end if;
  raise notice 'TEST 330 PASS  the moved stay follows its own feed''s dates, with no duplicate';

  -- TEST 331 - the new apartment's feed neither adopts nor cancels it.
  perform apply_airbnb_ical(v_to, pg_temp.feed(pg_temp.ev('own-1@airbnb.com', 430, 432)));
  select * into v_b from bookings where ical_uid = 'mv-1@airbnb.com';
  if v_b.status <> 'confirmed' or v_b.unit_id <> v_to then
    raise exception 'TEST 331 FAILED: %', row_to_json(v_b);
  end if;
  raise notice 'TEST 331 PASS  the new apartment''s feed leaves the moved stay alone';

  -- TEST 332 - gone from the original feed: cancelled, like any other stay.
  perform apply_airbnb_ical(v_from, pg_temp.feed(pg_temp.ev('mv-2@airbnb.com', 420, 422)));
  select * into v_b from bookings where ical_uid = 'mv-1@airbnb.com';
  if v_b.status <> 'cancelled' then
    raise exception 'TEST 332 FAILED: still %', v_b.status;
  end if;
  raise notice 'TEST 332 PASS  a moved stay cancelled on Airbnb is cancelled';

  delete from bookings where ical_uid in ('mv-1@airbnb.com', 'mv-2@airbnb.com', 'own-1@airbnb.com');
  delete from holiday_home_permits where unit_id = v_to;
  delete from units where id = v_to;
end $$;
