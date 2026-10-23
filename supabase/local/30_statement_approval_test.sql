-- ============================================================================
-- D|R|P PMS - Owner statements approved before they reach the owner (0060)
--
-- Runs after 02. Finance (66666666) generates and sends for approval; the
-- admin (11111111) is set as the approver. Removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/30_statement_approval_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.as_user(who text, sql text) returns text
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who, true);
  execute sql;
  perform set_config('role', 'postgres', true);
  return 'ok';
exception when others then
  perform set_config('role', 'postgres', true);
  return sqlstate;
end $$;

do $$
declare
  fin text := '66666666-6666-6666-6666-666666666666';
  adm text := '11111111-1111-1111-1111-111111111111';
  v_owner uuid := (select uo.owner_id from unit_ownerships uo join units u on u.id = uo.unit_id where u.unit_number = '2807');
  v_stmt uuid;
  t text;
begin
  update company_settings set statement_approver_id = adm::uuid where id;
  v_stmt := generate_owner_statement(v_owner, '2027-05-16', '2027-06-15', 20, true);

  -- TEST 300 - finance cannot send a draft to the owner itself; only the approver can.
  t := pg_temp.as_user(fin, format('update owner_statements set status = %L where id = %L', 'issued', v_stmt));
  if t <> '42501' or (select status from owner_statements where id = v_stmt) <> 'draft' then
    raise exception 'TEST 300 FAILED: finance issued a statement (%)', t;
  end if;
  raise notice 'TEST 300 PASS  only the approver takes a statement out of draft';

  -- TEST 301 - sending for approval notifies the approver, not the sender.
  t := pg_temp.as_user(fin, format('update owner_statements set submitted_at = now(), submitted_by = %L where id = %L', fin, v_stmt));
  if t <> 'ok'
     or not exists (select 1 from notifications where recipient_id = adm::uuid and kind = 'statement_review'
                      and link = '/finance/statements/' || v_stmt)
     or exists (select 1 from notifications where recipient_id = fin::uuid and kind = 'statement_review') then
    raise exception 'TEST 301 FAILED: %', t;
  end if;
  raise notice 'TEST 301 PASS  the approver is notified of a statement to approve';

  -- TEST 302 - the approver approves; the sender hears of it.
  t := pg_temp.as_user(adm, format('update owner_statements set status = %L, sent_at = now() where id = %L', 'issued', v_stmt));
  if t <> 'ok' or (select status from owner_statements where id = v_stmt) <> 'issued'
     or not exists (select 1 from notifications where recipient_id = fin::uuid and kind = 'statement_done'
                      and title = 'Statement approved and sent') then
    raise exception 'TEST 302 FAILED: %', t;
  end if;
  raise notice 'TEST 302 PASS  the approver sends it; whoever sent it for approval is told';

  -- TEST 303 - without an approver set, any super admin approves; finance still cannot.
  update company_settings set statement_approver_id = null where id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', fin, true);
  if can_approve_statements() then
    perform set_config('role', 'postgres', true);
    raise exception 'TEST 303 FAILED: finance may approve';
  end if;
  perform set_config('request.jwt.claim.sub', adm, true);
  if not can_approve_statements() then
    perform set_config('role', 'postgres', true);
    raise exception 'TEST 303 FAILED: a super admin may not approve';
  end if;
  perform set_config('role', 'postgres', true);
  raise notice 'TEST 303 PASS  no approver set: any super admin approves';

  delete from notifications where kind in ('statement_review', 'statement_done');
  delete from owner_statements where id = v_stmt;
end $$;
