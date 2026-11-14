-- ============================================================================
-- D|R|P PMS - One statement per unit for an owner with several (0075)
--
-- Runs after 02. Gives owner B (unit 2807) a second unit, with income on
-- both in September 2027, and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/39_statement_by_unit_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_u1 uuid := (select id from units where unit_number = '2807');
  v_u2 uuid;
  inc uuid := (select id from gl_categories where code = 'INC-BOOKING');
  s1 uuid;
  s2 uuid;
  st owner_statements%rowtype;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms, size_sqft,
                     furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, '2813', 'DRP-MG1-2813', 'apartment', 1, 1, 700, 'fully_furnished', 'short_term', 600, 2
    from units where id = v_u1
  returning id into v_u2;
  insert into unit_ownerships (unit_id, owner_id, ownership_pct, start_date) values (v_u2, v_owner, 100, '2026-01-01');
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-09-05', v_u1, v_owner, inc, 'income', 'Stay U1', 1000, false),
         ('2027-09-06', v_u2, v_owner, inc, 'income', 'Stay U2', 3000, false);

  -- TEST 390 - a statement for each unit carries that unit's income only, with its utilities under it.
  s1 := generate_owner_statement(v_owner, '2027-09-01', '2027-09-30', 20, false,
                                 '[{"description":"DEWA","amount":100}]'::jsonb, '[]'::jsonb, '[]'::jsonb, v_u1);
  s2 := generate_owner_statement(v_owner, '2027-09-01', '2027-09-30', 20, false,
                                 '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, v_u2);
  if (select gross_income_aed from owner_statements where id = s1) <> 1000
     or (select gross_income_aed from owner_statements where id = s2) <> 3000
     or (select unit_id from owner_statements where id = s2) <> v_u2
     or (select unit_label from owner_statement_lines where statement_id = s1 and description = 'DEWA') = 'Portfolio' then
    raise exception 'TEST 390 FAILED';
  end if;
  raise notice 'TEST 390 PASS  one statement per unit, each with its own income';

  -- TEST 391 - a second live statement for the same unit and period is refused; editing keeps the unit.
  begin
    perform generate_owner_statement(v_owner, '2027-09-01', '2027-09-30', 20, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, v_u1);
    raise exception 'TEST 391 FAILED: a second statement for the unit';
  exception when raise_exception then
    if sqlerrm not like '%already exists%' then raise; end if;
  end;
  s2 := revise_owner_statement(s2, '2027-09-01', '2027-09-30', 10, false);
  select * into st from owner_statements where id = s2;
  if st.unit_id <> v_u2 or st.gross_income_aed <> 3000 or st.management_fee_aed <> 300 then
    raise exception 'TEST 391 FAILED: %', row_to_json(st);
  end if;
  raise notice 'TEST 391 PASS  one live statement per unit and period; an edit keeps the unit';

  -- TEST 392 - another owner's unit is refused.
  begin
    perform generate_owner_statement(v_owner, '2027-10-01', '2027-10-31', 20, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                                     (select id from units where id not in (select unit_id from unit_ownerships where owner_id = v_owner) limit 1));
    raise exception 'TEST 392 FAILED: accepted';
  exception when check_violation then
    raise notice 'TEST 392 PASS  a unit that is not the owner''s is refused';
  end;

  update ledger_entries set statement_id = null where owner_id = v_owner and entry_date between '2027-09-01' and '2027-09-30';
  delete from owner_statements where owner_id = v_owner and period_start = '2027-09-01';
  delete from ledger_entries where owner_id = v_owner and entry_date between '2027-09-01' and '2027-09-30' and description like 'Stay U%';
  delete from unit_ownerships where unit_id = v_u2;
  delete from units where id = v_u2;
end $$;
