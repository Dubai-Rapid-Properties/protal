-- ============================================================================
-- D|R|P PMS - A booking's own fees on the statement (0073)
--
-- Runs after 02. Uses owner B (unit 2807) with income in July 2027, and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/36_booking_fees_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_unit uuid := (select id from units where unit_number = '2807');
  inc uuid := (select id from gl_categories where code = 'INC-BOOKING');
  a uuid;
  b uuid;
  v_stmt uuid;
  s owner_statements%rowtype;
  l owner_statement_lines%rowtype;
begin
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-07-05', v_unit, v_owner, inc, 'income', 'Stay F', 11340.00, false) returning id into a;
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-07-20', v_unit, v_owner, inc, 'income', 'Stay G', 1743.15, false) returning id into b;

  -- TEST 360 - fees with a deduction, and fees alone: taken off the rent at once.
  -- F: 11340 - 567 - 300 cleaning - 100 guest - 40 DTCM = 10333; G: 1743.15 - 116 = 1627.15
  v_stmt := generate_owner_statement(v_owner, '2027-07-01', '2027-07-31', 20, false, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('ledger_entry_id', a, 'amount', 567, 'items', '[{"description":"Cleaning fee","amount":300},{"description":"Guest fee","amount":100},{"description":"DTCM","amount":40}]'::jsonb),
      jsonb_build_object('ledger_entry_id', b, 'items', '[{"description":"Cleaning Airbnb Fee","amount":116}]'::jsonb)));
  select * into l from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = a;
  if l.amount_aed <> 10333 or l.deduction_aed <> 1007 or jsonb_array_length(l.deduction_items) <> 3 then
    raise exception 'TEST 360 FAILED: %', row_to_json(l);
  end if;
  select * into s from owner_statements where id = v_stmt;
  if s.gross_income_aed <> 11960.15 or s.management_fee_aed <> 2392.03 or s.net_payout_aed <> 9568.12 then
    raise exception 'TEST 360 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 360 PASS  a booking''s fees come off its rent with its deduction, fee worked out after';

  -- TEST 361 - a fee with no amount is refused.
  begin
    perform revise_owner_statement(v_stmt, '2027-07-01', '2027-07-31', 20, false, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('ledger_entry_id', a, 'items', '[{"description":"Guest fee","amount":0}]'::jsonb)));
    raise exception 'TEST 361 FAILED: accepted';
  exception when check_violation then
    raise notice 'TEST 361 PASS  a booking fee needs an amount';
  end;

  update ledger_entries set statement_id = null where id in (a, b);
  delete from owner_statements where owner_id = v_owner and period_start = '2027-07-01';
  delete from ledger_entries where id in (a, b);
end $$;
