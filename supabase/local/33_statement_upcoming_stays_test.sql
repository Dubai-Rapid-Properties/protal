-- ============================================================================
-- D|R|P PMS - Owner statement: the period's stays still to come (0068)
--
-- Runs after 02. Adds unit 2811 (owner F) with a stay starting 3 days from
-- today, inside a period ending 10 days from today, and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/33_statement_upcoming_stays_test.sql
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
  select property_id, '2811', 'DRP-MG1-2811', 'apartment', 1, 1, 800, 'fully_furnished', 'short_term', 650, 3
    from units where id = v_a
  returning id into v_unit;
  insert into owners (full_name, email) values ('Owner F', 'owner.f@example.com') returning id into v_owner;
  insert into unit_ownerships (unit_id, owner_id, ownership_pct, start_date) values (v_unit, v_owner, 100, '2026-01-01');
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification,
                                    issued_on, expires_on, status)
  values (v_unit, 'DET-HH-2026-24811', 'D|R|P Holiday Homes', 'Deluxe', '2026-01-01', current_date + 500, 'active');
  insert into management_agreements (unit_id, owner_id, service_mode, start_date, end_date, commission_pct, fee_vat_applicable)
  values (v_unit, v_owner, 'short_term', '2026-01-01', current_date + 700, 20, false);

  -- A stay still to come, well inside one statement period.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, 'direct', 'confirmed', v_today + 3, v_today + 5, 2, 1000) returning id into v_b;

  -- TEST 330 - the regular run (up to today) posts nothing for it.
  perform post_completed_bookings();
  if exists (select 1 from ledger_entries where source_table = 'bookings' and source_id = v_b) then
    raise exception 'TEST 330 FAILED: posted before its time';
  end if;
  raise notice 'TEST 330 PASS  a stay to come is not posted by the regular run';

  -- TEST 331 - posted up to a period's end, it is there; the regular run keeps it.
  perform post_completed_bookings(v_today + 10);
  perform post_completed_bookings();
  if (select count(*) from ledger_entries where source_table = 'bookings' and source_id = v_b and amount_aed = 1000) <> 1 then
    raise exception 'TEST 331 FAILED: %', (select string_agg(entry_date || '=' || amount_aed, ' ')
      from ledger_entries where source_table = 'bookings' and source_id = v_b);
  end if;
  raise notice 'TEST 331 PASS  posted up to the period end, and kept by the regular run';

  -- TEST 332 - on the statement for that period.
  v_stmt := generate_owner_statement(v_owner, v_today, v_today + 10, null, false, '[]'::jsonb, '[]'::jsonb);
  if (select gross_income_aed from owner_statements where id = v_stmt) <> 1000 then
    raise exception 'TEST 332 FAILED: %', (select row_to_json(s) from owner_statements s where id = v_stmt);
  end if;
  raise notice 'TEST 332 PASS  the stay to come is on the statement';
  delete from owner_statements where id = v_stmt;
  update ledger_entries set statement_id = null where owner_id = v_owner;

  -- TEST 333 - cancelled before any statement: its line goes.
  update bookings set status = 'cancelled', cancelled_on = v_today, cancellation_reason = 'test' where id = v_b;
  perform post_completed_bookings();
  if exists (select 1 from ledger_entries where source_table = 'bookings' and source_id = v_b) then
    raise exception 'TEST 333 FAILED: cancelled stay still posted';
  end if;
  raise notice 'TEST 333 PASS  a stay to come that is cancelled leaves the ledger';

  delete from owner_statements where owner_id = v_owner;
  delete from ledger_entries where owner_id = v_owner;
  delete from housekeeping_tasks where unit_id = v_unit;
  delete from availability_blocks where unit_id = v_unit;
  delete from bookings where unit_id = v_unit;
  delete from management_agreements where unit_id = v_unit;
  delete from holiday_home_permits where unit_id = v_unit;
  delete from unit_ownerships where unit_id = v_unit;
  delete from units where id = v_unit;
  delete from owners where id = v_owner;
end $$;
