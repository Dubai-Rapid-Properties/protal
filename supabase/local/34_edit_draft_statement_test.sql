-- ============================================================================
-- D|R|P PMS - Editing a draft owner statement (0071)
--
-- Runs after 02. Uses owner B (unit 2807) with income in June 2027, and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/34_edit_draft_statement_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_unit uuid := (select id from units where unit_number = '2807');
  inc uuid := (select id from gl_categories where code = 'INC-BOOKING');
  a uuid;
  v_first uuid;
  v_stmt uuid;
  v_number text;
  s owner_statements%rowtype;
  n integer;
begin
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-06-05', v_unit, v_owner, inc, 'income', 'Stay E', 5000.00, false) returning id into a;

  v_first := generate_owner_statement(v_owner, '2027-06-01', '2027-06-30', 20, true,
                                      '[{"description":"DEWA","amount":300}]'::jsonb);
  select statement_number into v_number from owner_statements where id = v_first;

  -- TEST 340 - the edit rebuilds the figures and keeps the number.
  v_stmt := revise_owner_statement(v_first, '2027-06-01', '2027-06-30', 15, false,
                                   '[{"description":"DEWA","amount":250},{"description":"Gas","amount":50}]'::jsonb,
                                   '[{"description":"Cleaning","amount":400}]'::jsonb,
                                   jsonb_build_array(jsonb_build_object('ledger_entry_id', a, 'amount', 1000)));
  select * into s from owner_statements where id = v_stmt;
  if s.statement_number <> v_number or s.gross_income_aed <> 4000 or s.management_fee_aed <> 600
     or s.vat_total_aed <> 0 or s.other_fees_aed <> 300 or s.other_charges_aed <> 400
     or s.net_payout_aed <> 3100 or s.status <> 'draft' then
    raise exception 'TEST 340 FAILED: %', row_to_json(s);
  end if;
  select count(*) into n from owner_statements where id = v_first;
  if n <> 0 or (select statement_id from ledger_entries where id = a) <> v_stmt then
    raise exception 'TEST 340 FAILED: the old draft or its ledger line was left behind';
  end if;
  raise notice 'TEST 340 PASS  an edited draft is rebuilt, with its number kept';

  -- TEST 341 - the next statement still gets a new number.
  if current_setting('pms.keep_statement_number', true) <> '' then
    raise exception 'TEST 341 FAILED: the kept number was left set';
  end if;
  raise notice 'TEST 341 PASS  the kept number does not reach the next statement';

  -- TEST 342 - a draft waiting for approval cannot be edited.
  update owner_statements set submitted_at = now() where id = v_stmt;
  begin
    perform revise_owner_statement(v_stmt, '2027-06-01', '2027-06-30', 20, true);
    raise exception 'TEST 342 FAILED: edited while waiting for approval';
  exception when check_violation then
    raise notice 'TEST 342 PASS  a statement waiting for approval cannot be edited';
  end;

  update ledger_entries set statement_id = null where id = a;
  delete from owner_statements where id = v_stmt;
  delete from ledger_entries where id = a;
end $$;
