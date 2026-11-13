-- ============================================================================
-- D|R|P PMS - Owner statement: maintenance fees, and adding to a booking's rent (0072)
--
-- Runs after 02. Adds unit 2812 (owner G) with one past stay, and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/35_statement_maintenance_and_additions_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_a uuid := (select id from units where unit_number = '2807');
  v_unit uuid;
  v_owner uuid;
  v_b uuid;
  v_le uuid;
  v_stmt uuid;
  s owner_statements%rowtype;
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
  insert into management_agreements (unit_id, owner_id, service_mode, start_date, end_date, commission_pct, fee_vat_applicable)
  values (v_unit, v_owner, 'short_term', '2026-01-01', current_date + 700, 20, false);
  -- An Airbnb stay whose payout came in as one night's rate only.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, 'airbnb', 'checked_out', '2026-06-02', '2026-06-07', 2, 300) returning id into v_b;
  perform post_completed_bookings();
  select id into v_le from ledger_entries where source_table = 'bookings' and source_id = v_b;

  v_stmt := generate_owner_statement(v_owner, '2026-06-01', '2026-06-30', 20, false,
    '[{"description": "DEWA", "amount": 100}, {"description": "AC service", "amount": 150, "kind": "maintenance"}]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('ledger_entry_id', v_le, 'amount', -1200)));
  select * into s from owner_statements where id = v_stmt;

  -- TEST 350 - the addition goes on the rent: 300 + 1200 = 1500, fee 20% = 300.
  if s.gross_income_aed <> 1500 or s.management_fee_aed <> 300
     or (select deduction_aed from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = v_le) <> -1200 then
    raise exception 'TEST 350 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 350 PASS  an addition puts the rent right, and the fee follows it';

  -- TEST 351 - the maintenance fee is a Maintenance line; the utility fee stays a utility line.
  if (select category_code from owner_statement_lines where statement_id = v_stmt and description = 'AC service') <> 'EXP-MAINT'
     or (select category_code from owner_statement_lines where statement_id = v_stmt and description = 'DEWA') <> 'EXP-OTHER-FEES'
     or s.net_payout_aed <> 1500 - 100 - 150 - 300 then
    raise exception 'TEST 351 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 351 PASS  maintenance fees on the Maintenance row, taken off the payout';

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
