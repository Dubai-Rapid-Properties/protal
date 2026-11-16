-- ============================================================================
-- D|R|P PMS - Taking a booking off an owner statement (0076)
--
-- Runs after 02. Uses owner B (unit 2807) with income in October 2027, and
-- removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/40_statement_remove_booking_test.sql
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
begin
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-10-05', v_unit, v_owner, inc, 'income', 'Stay K', 1000, false) returning id into a;
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-10-07', v_unit, v_owner, inc, 'income', 'Stay L', 2500, false) returning id into b;

  -- TEST 400 - a booking taken off is not on the statement and stays free.
  v_stmt := generate_owner_statement(v_owner, '2027-10-01', '2027-10-31', 20, false, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('ledger_entry_id', b, 'exclude', true)));
  select * into s from owner_statements where id = v_stmt;
  if s.gross_income_aed <> 1000 or s.excluded_entries <> array[b]
     or exists (select 1 from owner_statement_lines where statement_id = v_stmt and ledger_entry_id = b)
     or (select statement_id from ledger_entries where id = b) is not null
     or (select statement_id from ledger_entries where id = a) <> v_stmt then
    raise exception 'TEST 400 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 400 PASS  a booking taken off a statement is left out, free for a later one';

  -- TEST 401 - put back on an edit.
  v_stmt := revise_owner_statement(v_stmt, '2027-10-01', '2027-10-31', 20, false);
  select * into s from owner_statements where id = v_stmt;
  if s.gross_income_aed <> 3500 or s.excluded_entries is not null then
    raise exception 'TEST 401 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 401 PASS  an edit can put it back';

  update ledger_entries set statement_id = null where id in (a, b);
  delete from owner_statements where id = v_stmt;
  delete from ledger_entries where id in (a, b);
end $$;
