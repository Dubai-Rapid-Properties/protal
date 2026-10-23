-- ============================================================================
-- D|R|P PMS - Booking deductions and other fees as a % (0061)
--
-- Runs after 02. Uses owner B (unit 2807) with income in May 2027, and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/31_statement_deductions_test.sql
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
  values ('2027-05-05', v_unit, v_owner, inc, 'income', 'Stay A', 6533.24, false) returning id into a;
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-05-20', v_unit, v_owner, inc, 'income', 'Stay B', 2000.00, false) returning id into b;

  -- TEST 310 - a deduction in AED and one in %: the statement shows the rent after them.
  -- A: 6533.24 - 533.24 = 6000.00, fee 20% 1200.00, VAT 60.00
  -- B: 2000 - 15% (300.00) = 1700.00, fee 340.00, VAT 17.00
  v_stmt := generate_owner_statement(v_owner, '2027-05-01', '2027-05-31', 20, true, '[]'::jsonb,
    '[{"description": "Admin", "pct": 10}, {"description": "Courier", "amount": 25}]'::jsonb,
    jsonb_build_array(jsonb_build_object('ledger_entry_id', a, 'amount', 533.24),
                      jsonb_build_object('ledger_entry_id', b, 'pct', 15)));
  select * into s from owner_statements where id = v_stmt;
  select * into l from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = a;
  if l.amount_aed <> 6000.00 or l.total_aed <> 6000.00 or l.original_amount_aed <> 6533.24 or l.deduction_aed <> 533.24
     or l.mgmt_fee_aed <> 1200.00 then
    raise exception 'TEST 310 FAILED (A): %', row_to_json(l);
  end if;
  select * into l from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = b;
  if l.amount_aed <> 1700.00 or l.deduction_aed <> 300.00 or l.mgmt_fee_aed <> 340.00 then
    raise exception 'TEST 310 FAILED (B): %', row_to_json(l);
  end if;
  -- income 7700.00; fee 1540.00 + VAT 77.00; net 6083.00
  if s.gross_income_aed <> 7700.00 or s.management_fee_aed <> 1540.00 or s.vat_total_aed <> 77.00
     or s.net_payout_aed <> 6083.00
     or (select amount_aed from ledger_entries where id = a) <> 6533.24 then
    raise exception 'TEST 310 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 310 PASS  booking deductions in AED and %%; the ledger keeps the full payout';

  -- TEST 311 - an other fee as a % of the booking income: 10% of 7700 = 770.00, plus 25.
  if s.other_charges_aed <> 795.00
     or s.other_charges -> 0 ->> 'amount' <> '770.00' or (s.other_charges -> 0 ->> 'pct')::numeric <> 10 then
    raise exception 'TEST 311 FAILED: % %', s.other_charges_aed, s.other_charges;
  end if;
  raise notice 'TEST 311 PASS  other fees as a %% of booking income, kept with the %%';

  -- TEST 312 - a deduction above the rent, or both an amount and a %, is refused.
  update owner_statements set status = 'void' where id = v_stmt;
  begin
    perform generate_owner_statement(v_owner, '2027-05-01', '2027-05-31', 20, true, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('ledger_entry_id', b, 'amount', 2000.01)));
    raise exception 'TEST 312 FAILED: a deduction above the rent was taken';
  exception when check_violation then null;
  end;
  begin
    perform generate_owner_statement(v_owner, '2027-05-01', '2027-05-31', 20, true, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('ledger_entry_id', b, 'amount', 5, 'pct', 5)));
    raise exception 'TEST 312 FAILED: both an amount and a %% were taken';
  exception when check_violation then null;
  end;
  raise notice 'TEST 312 PASS  impossible deductions refused';

  delete from owner_statements where owner_id = v_owner and period_start = '2027-05-01';
  delete from ledger_entries where id in (a, b);
end $$;
