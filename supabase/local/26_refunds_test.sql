-- ============================================================================
-- D|R|P PMS - Refunds (0052)
--
-- Runs after 02. Adds refunds as housekeeping, settles them as a super admin,
-- and removes what it adds.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/26_refunds_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.as_user(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

create or replace function pg_temp.as_postgres() returns void
language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;

do $$
declare
  admin uuid := '11111111-1111-1111-1111-111111111111';
  finance uuid := '66666666-6666-6666-6666-666666666666';
  housekeeping uuid := '99999999-9999-9999-9999-999999999999';
  owner uuid := '33333333-3333-3333-3333-333333333333';
  v_id uuid;
  n integer;
begin
  -- TEST 260 - any staff member adds a claim; super admins and finance hear of it.
  perform pg_temp.as_user(housekeeping);
  insert into refunds (spent_by, description, amount_aed) values ('Delia', 'Cleaning supplies', 85.5)
  returning id into v_id;
  perform pg_temp.as_postgres();
  select count(*) into n from notifications where kind = 'refund_new' and recipient_id in (admin, finance)
     and title = 'Refund claim: AED 85.50' and body = 'Delia paid for Cleaning supplies';
  if n <> 2 then raise exception 'TEST 260 FAILED: % notifications', n; end if;
  raise notice 'TEST 260 PASS  staff add a claim; super admins and finance are notified';

  -- TEST 261 - owners neither see nor add claims.
  perform pg_temp.as_user(owner);
  select count(*) into n from refunds;
  perform pg_temp.as_postgres();
  if n <> 0 then raise exception 'TEST 261 FAILED: an owner sees % claims', n; end if;
  begin
    perform pg_temp.as_user(owner);
    insert into refunds (spent_by, description, amount_aed) values ('Owner', 'x', 1);
    raise exception 'TEST 261 FAILED: an owner added a claim';
  exception when insufficient_privilege then
    perform pg_temp.as_postgres();
  end;
  raise notice 'TEST 261 PASS  owners neither see nor add claims';

  -- TEST 262 - only a super admin settles; the one who added it hears.
  begin
    perform pg_temp.as_user(housekeeping);
    update refunds set status = 'refunded' where id = v_id;
    raise exception 'TEST 262 FAILED: housekeeping settled a claim';
  exception when insufficient_privilege then
    perform pg_temp.as_postgres();
  end;
  perform pg_temp.as_user(admin);
  update refunds set status = 'refunded', settled_on = current_date, settled_by = admin where id = v_id;
  perform pg_temp.as_postgres();
  select count(*) into n from notifications where kind = 'refund_settled' and recipient_id = housekeeping
     and title = 'Refunded: AED 85.50';
  if n <> 1 then raise exception 'TEST 262 FAILED: % settle notifications', n; end if;
  raise notice 'TEST 262 PASS  a super admin settles; the claimant is notified';

  -- TEST 263 - deleting a claim takes its notifications with it, for everyone.
  select count(*) into n from notifications where refund_id = v_id;
  if n <> 3 then raise exception 'TEST 263 FAILED: % notifications carry the claim', n; end if;
  perform pg_temp.as_user(admin);
  delete from refunds where id = v_id;
  perform pg_temp.as_postgres();
  select count(*) into n from notifications
   where kind in ('refund_new', 'refund_settled') and body like 'Delia%Cleaning supplies%';
  if n <> 0 then raise exception 'TEST 263 FAILED: % notifications outlived the claim', n; end if;
  raise notice 'TEST 263 PASS  deleting a claim removes its notifications for everyone';

  delete from notifications where kind in ('refund_new', 'refund_settled');
  delete from refunds where id = v_id;
end $$;
