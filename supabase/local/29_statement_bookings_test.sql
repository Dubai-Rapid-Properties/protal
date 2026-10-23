-- ============================================================================
-- D|R|P PMS - Owner statement: booking breakdown, fee per booking, occupancy (0057)
--
-- Runs after 02. Adds unit 2809 (owner D, 20% + VAT agreement) with three
-- stays around June 2026, and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/29_statement_bookings_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_a uuid := (select id from units where unit_number = '2807');
  v_unit uuid;
  v_owner uuid;
  v_guest uuid;
  v_b1 uuid;
  v_b2 uuid;
  v_b3 uuid;
  v_long uuid;
  v_stmt uuid;
  s owner_statements%rowtype;
  l owner_statement_lines%rowtype;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms,
                     size_sqft, furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, '2809', 'DRP-MG1-2809', 'apartment', 1, 1, 800, 'fully_furnished', 'short_term', 650, 3
    from units where id = v_a
  returning id into v_unit;
  insert into owners (full_name, email) values ('Owner D', 'owner.d@example.com') returning id into v_owner;
  insert into unit_ownerships (unit_id, owner_id, ownership_pct, start_date) values (v_unit, v_owner, 100, '2026-01-01');
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification,
                                    issued_on, expires_on, status)
  values (v_unit, 'DET-HH-2026-24809', 'D|R|P Holiday Homes', 'Deluxe', '2026-01-01', current_date + 500, 'active');
  insert into management_agreements (unit_id, owner_id, service_mode, start_date, end_date, commission_pct, fee_vat_applicable)
  values (v_unit, v_owner, 'short_term', '2026-01-01', '2027-12-31', 20, true);
  insert into guests (full_name) values ('Anna Lee') returning id into v_guest;

  -- Ends 2 June: on June's statement, one of its nights in June.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, 'airbnb', 'checked_out', '2026-05-28', '2026-06-02', 2, 1500.55) returning id into v_b3;
  insert into booking_guests (booking_id, full_name, is_lead_guest) values (v_b3, 'Ravi Kumar', true);
  -- All in June.
  insert into bookings (unit_id, guest_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, v_guest, 'direct', 'checked_out', '2026-06-02', '2026-06-07', 2, 2000) returning id into v_b1;
  -- Ends 3 July: on July's statement, four of its nights in June.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, 'booking_com', 'checked_out', '2026-06-27', '2026-07-03', 2, 2400) returning id into v_b2;
  perform post_completed_bookings();

  v_stmt := generate_owner_statement(v_owner, '2026-06-01', '2026-06-30', null, true, '[]'::jsonb,
                                     '[{"description": "Internal admin", "amount": 50}]'::jsonb);
  select * into s from owner_statements where id = v_stmt;

  -- TEST 290 - the fee booking by booking from the agreement, with VAT; the sums match.
  -- 1500.55 x 20% = 300.11, VAT 15.01; 2000 x 20% = 400.00, VAT 20.00.
  if s.gross_income_aed <> 3500.55 or s.management_fee_aed <> 700.11 or s.vat_total_aed <> 35.01
     or s.management_fee_aed <> (select sum(mgmt_fee_aed) from owner_statement_lines where statement_id = v_stmt)
     or s.vat_total_aed <> (select sum(mgmt_fee_vat_aed) from owner_statement_lines where statement_id = v_stmt)
     or exists (select 1 from owner_statement_lines where statement_id = v_stmt and category_code = 'EXP-MGMT-FEE') then
    raise exception 'TEST 290 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 290 PASS  management fee and its VAT per booking, summing to the statement';

  -- TEST 291 - each booking line carries its guest, dates and nights.
  select * into l from owner_statement_lines where statement_id = v_stmt and booking_id = v_b3;
  if l.guest_name is distinct from 'Ravi Kumar' or l.check_in <> '2026-05-28' or l.check_out <> '2026-06-02'
     or l.nights <> 5 or l.mgmt_fee_aed <> 300.11 or l.mgmt_fee_vat_aed <> 15.01 then
    raise exception 'TEST 291 FAILED (lead guest): %', row_to_json(l);
  end if;
  select * into l from owner_statement_lines where statement_id = v_stmt and booking_id = v_b1;
  if l.guest_name is distinct from 'Anna Lee' or l.nights <> 5 or l.mgmt_fee_aed <> 400.00 then
    raise exception 'TEST 291 FAILED (guest): %', row_to_json(l);
  end if;
  raise notice 'TEST 291 PASS  booking lines carry guest, check-in, check-out and nights';

  -- TEST 292 - bookings, nights rented, occupancy (1 + 5 + 4 of 30 nights = 33.3%).
  if s.bookings_count <> 2 or s.rented_nights <> 10 or s.occupancy_pct <> 33.3 then
    raise exception 'TEST 292 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 292 PASS  2 bookings, 10 nights, 33.3%% occupancy';

  -- TEST 293 - other fees are kept for staff and not taken off the payout.
  -- net 3500.55 - 700.11 - 35.01 = 2765.43
  if s.other_charges_aed <> 50 or s.net_payout_aed <> 2765.43 or s.closing_balance_aed <> 2765.43 then
    raise exception 'TEST 293 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 293 PASS  other fees kept for staff, owner payout untouched';

  -- TEST 294 - a unit linked to its owner after the period still counts for occupancy (0058).
  update owner_statements set status = 'void' where id = v_stmt;
  update unit_ownerships set start_date = current_date where unit_id = v_unit;
  v_stmt := generate_owner_statement(v_owner, '2026-06-01', '2026-06-30', 20, true);
  select * into s from owner_statements where id = v_stmt;
  if s.occupancy_pct is distinct from 33.3 or s.bookings_count <> 2 then
    raise exception 'TEST 294 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 294 PASS  occupancy counts a unit linked after the period';

  -- TEST 295 - a long stay posts in parts, one per statement period (0059).
  -- 10 Jul - 20 Sep, 72 nights, AED 7,200.50: 6, 31, 31 and 4 nights.
  insert into bookings (unit_id, guest_id, channel, status, check_in, check_out, adults, payout_expected_aed)
  values (v_unit, v_guest, 'direct', 'confirmed', '2026-07-10', '2026-09-20', 2, 7200.50) returning id into v_long;
  perform post_completed_bookings();
  if (select string_agg(entry_date || '=' || amount_aed || '/' || stay_nights, ' ' order by entry_date)
        from ledger_entries where source_table = 'bookings' and source_id = v_long)
     <> '2026-07-15=600.04/6 2026-08-15=3100.22/31 2026-09-15=3100.22/31 2026-09-20=400.02/4' then
    raise exception 'TEST 295 FAILED: %', (select string_agg(entry_date || '=' || amount_aed || '/' || stay_nights, ' ' order by entry_date)
        from ledger_entries where source_table = 'bookings' and source_id = v_long);
  end if;
  v_stmt := generate_owner_statement(v_owner, '2026-08-16', '2026-09-15', 20, true);
  select * into s from owner_statements where id = v_stmt;
  -- 3100.22 x 20% = 620.04, VAT 31.00; 31 of 31 nights booked.
  if s.gross_income_aed <> 3100.22 or s.bookings_count <> 1 or s.rented_nights <> 31
     or s.occupancy_pct <> 100 or s.management_fee_aed <> 620.04 or s.vat_total_aed <> 31.00
     or (select nights from owner_statement_lines where statement_id = v_stmt and booking_id = v_long) <> 31 then
    raise exception 'TEST 295 FAILED (statement): %', row_to_json(s);
  end if;
  raise notice 'TEST 295 PASS  a long stay posts by the nights in each period, adding up to its payout';

  -- TEST 296 - a part in a statement is frozen; a new payout lands on the others.
  update bookings set payout_expected_aed = 7300.50 where id = v_long;
  perform post_completed_bookings();
  if (select sum(amount_aed) from ledger_entries where source_table = 'bookings' and source_id = v_long) <> 7300.50
     or (select amount_aed from ledger_entries where source_table = 'bookings' and source_id = v_long
          and entry_date = '2026-09-15') <> 3100.22 then
    raise exception 'TEST 296 FAILED: %', (select string_agg(entry_date || '=' || amount_aed, ' ' order by entry_date)
        from ledger_entries where source_table = 'bookings' and source_id = v_long);
  end if;
  raise notice 'TEST 296 PASS  stated part frozen; the parts still add up to the new payout';

  -- TEST 297 - a stay ending on the 16th is dated the 15th, in the period of its last night.
  if (select entry_date from ledger_entries where source_table = 'bookings' and source_id = v_b3) <> '2026-06-02'
     or (select array_agg(p.entry_date order by p.entry_date) from pms.stay_parts('2026-10-01', '2026-10-16') p)
        <> array['2026-10-15'::date] then
    raise exception 'TEST 297 FAILED';
  end if;
  raise notice 'TEST 297 PASS  a check-out on the 16th belongs to the period closing on the 15th';

  delete from owner_statements where owner_id = v_owner;
  delete from ledger_entries where owner_id = v_owner;
  delete from housekeeping_tasks where unit_id = v_unit;
  delete from availability_blocks where unit_id = v_unit;
  delete from bookings where unit_id = v_unit;
  delete from guests where id = v_guest;
  delete from management_agreements where unit_id = v_unit;
  delete from holiday_home_permits where unit_id = v_unit;
  delete from unit_ownerships where unit_id = v_unit;
  delete from units where id = v_unit;
  delete from owners where id = v_owner;
end $$;
