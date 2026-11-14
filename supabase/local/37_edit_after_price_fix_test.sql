-- ============================================================================
-- D|R|P PMS - Editing a draft picks up a booking's corrected price (0074)
--
-- Runs after 02. Adds its own unit, owner and stay, relative to today, and
-- removes them.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/37_edit_after_price_fix_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_a uuid := (select id from units where unit_number = '2807');
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_unit uuid;
  v_owner uuid;
  v_b uuid;
  v_stmt uuid;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms,
                     size_sqft, furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, '2812', 'DRP-MG1-2812', 'apartment', 1, 1, 800, 'fully_furnished', 'short_term', 650, 3
    from units where id = v_a
  returning id into v_unit;
  insert into owners (full_name, email) values ('Owner G', 'owner.g@example.com') returning id into v_owner;
  insert into unit_ownerships (unit_id, owner_id, ownership_pct, start_date) values (v_unit, v_owner, 100, '2026-01-01');
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification,
                                    issued_on, expires_on, status)
  values (v_unit, 'DET-HH-2026-24812', 'D|R|P Holiday Homes', 'Deluxe', '2026-01-01', current_date + 500, 'active');

  -- A stay priced at one night's rate by mistake.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, 'direct', 'confirmed', v_today + 3, v_today + 5, 2, 577.51) returning id into v_b;
  perform post_completed_bookings(v_today + 10);
  v_stmt := generate_owner_statement(v_owner, v_today, v_today + 10, 20, false);

  -- TEST 370 - the price is put right on the booking, then the draft is edited.
  update bookings set payout_expected_aed = 1155.02 where id = v_b;
  perform post_completed_bookings(v_today + 10);      -- as the edit action does first
  v_stmt := revise_owner_statement(v_stmt, v_today, v_today + 10, 20, false);
  if (select gross_income_aed from owner_statements where id = v_stmt) <> 1155.02 then
    raise exception 'TEST 370 FAILED: %', (select row_to_json(s) from owner_statements s where id = v_stmt);
  end if;
  raise notice 'TEST 370 PASS  an edited draft carries the booking''s corrected price';

  delete from owner_statements where owner_id = v_owner;
  delete from ledger_entries where owner_id = v_owner;
  delete from housekeeping_tasks where unit_id = v_unit;
  delete from availability_blocks where unit_id = v_unit;
  delete from bookings where unit_id = v_unit;
  delete from holiday_home_permits where unit_id = v_unit;
  delete from unit_ownerships where unit_id = v_unit;
  delete from units where id = v_unit;
  delete from owners where id = v_owner;
end $$;
