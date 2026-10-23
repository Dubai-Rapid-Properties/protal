-- ============================================================================
-- D|R|P PMS - Statement fees set when generating; voiding frees the lines (0054)
--
-- Runs after 02. Uses owner B (unit 2807) with ledger lines in March 2027,
-- and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/28_statement_fees_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_unit uuid := (select id from units where unit_number = '2807');
  inc uuid := (select id from gl_categories where code = 'INC-BOOKING');
  exp uuid := (select id from gl_categories where code = 'EXP-MAINT');
  s owner_statements%rowtype;
  v_first uuid;
  v_second uuid;
  n integer;
begin
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction, description, amount_aed, vat_applicable)
  values ('2027-03-05', v_unit, v_owner, inc, 'income', 'Stay A', 1000.00, false),
         ('2027-03-20', v_unit, v_owner, inc, 'income', 'Stay B', 2500.55, false),
         ('2027-03-22', v_unit, v_owner, exp, 'expense', 'Plumber', 200.00, true);

  -- TEST 280 - the fee finance set, VAT on it, other fees: to the fils.
  v_first := generate_owner_statement(v_owner, '2027-03-01', '2027-03-31', 15, true, 75.25, 'Key cutting');
  select * into s from owner_statements where id = v_first;
  -- income 3500.55; expense 200 + VAT 10 = 210; fee round(525.0825) = 525.08;
  -- VAT on fee round(26.254) = 26.25; other 75.25; net 2663.97
  if s.gross_income_aed <> 3500.55 or s.total_expenses_aed <> 210.00 or s.management_fee_aed <> 525.08
     or s.vat_total_aed <> 26.25 or s.other_fees_aed <> 75.25 or s.net_payout_aed <> 2663.97
     or s.management_fee_pct <> 15 then
    raise exception 'TEST 280 FAILED: %', row_to_json(s);
  end if;
  select count(*) into n from owner_statement_lines where statement_id = v_first
     and ((category_code = 'EXP-MGMT-FEE' and description = 'Management fee (15% of AED 3,500.55)' and total_aed = 551.33)
          or (category_code = 'EXP-OTHER-FEES' and description = 'Other fees: Key cutting' and total_aed = 75.25));
  if n <> 2 then raise exception 'TEST 280 FAILED: fee lines %', n; end if;
  raise notice 'TEST 280 PASS  fee %%, VAT on it and other fees, to the fils';

  -- TEST 281 - void frees the lines and the period; the replacement, without VAT, finds them again.
  update owner_statements set status = 'void' where id = v_first;
  v_second := generate_owner_statement(v_owner, '2027-03-01', '2027-03-31', 12.5, false, 0, null);
  select * into s from owner_statements where id = v_second;
  -- fee round(437.56875) = 437.57; no VAT; net 3500.55 - 210 - 437.57 = 2852.98
  if s.gross_income_aed <> 3500.55 or s.management_fee_aed <> 437.57 or s.vat_total_aed <> 0
     or s.net_payout_aed <> 2852.98 then
    raise exception 'TEST 281 FAILED: %', row_to_json(s);
  end if;
  raise notice 'TEST 281 PASS  a void statement frees its income for the corrected one';

  -- TEST 282 - a void statement stays void; a second live one for the period is refused.
  begin
    update owner_statements set status = 'draft' where id = v_first;
    raise exception 'TEST 282 FAILED: a void statement came back';
  exception when check_violation then null;
  end;
  begin
    perform generate_owner_statement(v_owner, '2027-03-01', '2027-03-31', 10);
    raise exception 'TEST 282 FAILED: two live statements for one period';
  exception when raise_exception then
    if sqlerrm not like '%already exists%' then raise; end if;
  end;
  raise notice 'TEST 282 PASS  void stays void; one live statement per period';

  -- TEST 283 - only dulshan@ deletes a statement; its income is freed again.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    perform delete_owner_statement(v_second);
    raise exception 'TEST 283 FAILED: another super admin deleted a statement';
  exception when insufficient_privilege then
    perform set_config('role', 'postgres', true);
  end;
  update profiles set email = 'Dulshan@dubairapidproperties.com' where id = '11111111-1111-1111-1111-111111111111';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform delete_owner_statement(v_second);
  perform set_config('role', 'postgres', true);
  update profiles set email = 'admin@drp.ae' where id = '11111111-1111-1111-1111-111111111111';
  if exists (select 1 from owner_statements where id = v_second)
     or exists (select 1 from ledger_entries where unit_id = v_unit and statement_id is not null
                  and entry_date between '2027-03-01' and '2027-03-31') then
    raise exception 'TEST 283 FAILED: statement or its ledger link remains';
  end if;
  raise notice 'TEST 283 PASS  only dulshan@ deletes a statement; its income is free again';

  delete from owner_statements where id in (v_first, v_second);
  delete from ledger_entries where unit_id = v_unit and entry_date between '2027-03-01' and '2027-03-31';
end $$;
