-- ============================================================================
-- D|R|P PMS - A booking's rent and dates set by hand on the statement (0075)
--
-- Runs after 02. Uses owner B (unit 2807) with income in August 2027, and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/38_booking_set_by_hand_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_unit uuid := (select id from units where unit_number = '2807');
  inc uuid := (select id from gl_categories where code = 'INC-BOOKING');
  a uuid;
  v_stmt uuid;
  s owner_statements%rowtype;
  l owner_statement_lines%rowtype;
begin
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable, stay_nights)
  values ('2027-08-15', v_unit, v_owner, inc, 'income', 'Stay H', 577.51, false, 31) returning id into a;

  -- TEST 380 - rent and dates by hand, then 10% off and a cleaning fee.
  -- Rent 5605.57 - 560.56 - 100 = 4945.01; 20 nights.
  v_stmt := generate_owner_statement(v_owner, '2027-07-16', '2027-08-15', 20, false, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('ledger_entry_id', a, 'rent', 5605.57, 'check_in', '2027-07-20',
      'check_out', '2027-08-09', 'pct', 10, 'items', '[{"description":"Cleaning fee","amount":100}]'::jsonb)));
  select * into l from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = a;
  if l.amount_aed <> 4945.01 or l.nights <> 20 or l.check_in <> '2027-07-20' or l.check_out <> '2027-08-09'
     or l.original_amount_aed <> 577.51 or (l.adjustment->>'rent')::numeric <> 5605.57 or l.adjustment ? 'ledger_entry_id' then
    raise exception 'TEST 380 FAILED: %', row_to_json(l);
  end if;
  select * into s from owner_statements where id = v_stmt;
  if s.gross_income_aed <> 4945.01 or s.management_fee_aed <> 989.00 then
    raise exception 'TEST 380 FAILED: %', row_to_json(s);
  end if;
  if (select amount_aed from ledger_entries where id = a) <> 577.51 then
    raise exception 'TEST 380 FAILED: the ledger was changed';
  end if;
  raise notice 'TEST 380 PASS  rent and dates set by hand, with the deduction and fees after; ledger untouched';

  -- TEST 381 - dates out of order are refused.
  begin
    perform revise_owner_statement(v_stmt, '2027-07-16', '2027-08-15', 20, false, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('ledger_entry_id', a, 'check_in', '2027-08-09', 'check_out', '2027-07-20')));
    raise exception 'TEST 381 FAILED: accepted';
  exception when check_violation then
    raise notice 'TEST 381 PASS  a check-out before the check-in is refused';
  end;

  update ledger_entries set statement_id = null where id = a;
  delete from owner_statements where id = v_stmt;
  delete from ledger_entries where id = a;
end $$;
