-- ============================================================================
-- D|R|P PMS - Guest incidents are staff only (0033)
--
-- Runs after 02-10 and reuses their fixtures: unit 2807 (owner B, assigned
-- to the property manager) and its bookings, and unit 1204 (owner A).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/11_guest_incidents_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.act_as(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
end $$;

create or replace function pg_temp.act_as_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

do $$
declare
  v_2807  uuid := (select id from units where unit_number = '2807');
  v_1204  uuid := (select id from units where unit_number = '1204');
  v_bk    uuid := (select id from bookings where unit_id = (select id from units where unit_number = '2807')
                    order by check_in limit 1);
  v_inc   uuid;
  n       integer;
  r       guest_incidents%rowtype;
begin
  -- TEST 80 - the property manager records an incident on a stay.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  insert into guest_incidents (unit_id, booking_id, category, description, charge_aed, reported_by)
  values (v_2807, v_bk, 'vomit', 'Guest was sick on the living room rug.', 350,
          '22222222-2222-2222-2222-222222222222')
  returning id into v_inc;
  select count(*) into n from guest_incidents where id = v_inc;
  perform pg_temp.act_as_postgres();
  if n <> 1 then raise exception 'TEST 80 FAILED: staff cannot read their own incident'; end if;
  raise notice 'TEST 80 PASS  property manager records and reads an incident on a stay';

  -- TEST 81 - neither owner sees it, nor the tenant.
  perform pg_temp.act_as('44444444-4444-4444-4444-444444444444');
  select count(*) into n from guest_incidents;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 81 FAILED: owner B reads % incidents on their own unit', n; end if;
  perform pg_temp.act_as('33333333-3333-3333-3333-333333333333');
  select count(*) into n from guest_incidents;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 81 FAILED: owner A reads % incidents', n; end if;
  perform pg_temp.act_as('55555555-5555-5555-5555-555555555555');
  select count(*) into n from guest_incidents;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 81 FAILED: tenant reads % incidents', n; end if;
  raise notice 'TEST 81 PASS  owners and tenants read no incidents, even on their own unit';

  -- TEST 82 - an owner can neither record nor change one.
  perform pg_temp.act_as('44444444-4444-4444-4444-444444444444');
  begin
    insert into guest_incidents (unit_id, category, description) values (v_2807, 'other', 'Owner trying');
    raise exception 'TEST 82 FAILED: owner recorded an incident';
  exception when insufficient_privilege then null;
  end;
  update guest_incidents set description = 'changed' where id = v_inc;
  get diagnostics n = row_count;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 82 FAILED: owner changed an incident'; end if;
  raise notice 'TEST 82 PASS  owners cannot record or change incidents';

  -- TEST 83 - the stay must be on the incident's unit.
  begin
    insert into guest_incidents (unit_id, booking_id, category, description)
    values (v_1204, v_bk, 'damage', 'Wrong unit for this stay');
    raise exception 'TEST 83 FAILED: booking from another unit accepted';
  exception when check_violation then
    raise notice 'TEST 83 PASS  a stay from another unit is refused';
  end;

  -- TEST 84 - resolving stamps the time; reopening clears it.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  update guest_incidents set status = 'resolved', resolution = 'Charged from the deposit.' where id = v_inc;
  select * into r from guest_incidents where id = v_inc;
  if r.resolved_at is null then raise exception 'TEST 84 FAILED: resolved_at not set'; end if;
  update guest_incidents set status = 'open' where id = v_inc;
  select * into r from guest_incidents where id = v_inc;
  perform pg_temp.act_as_postgres();
  if r.resolved_at is not null then raise exception 'TEST 84 FAILED: resolved_at kept after reopening'; end if;
  raise notice 'TEST 84 PASS  resolving stamps the time, reopening clears it';

  -- TEST 85 - only an admin deletes.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  delete from guest_incidents where id = v_inc;
  get diagnostics n = row_count;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 85 FAILED: property manager deleted an incident'; end if;
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  delete from guest_incidents where id = v_inc;
  get diagnostics n = row_count;
  perform pg_temp.act_as_postgres();
  if n <> 1 then raise exception 'TEST 85 FAILED: admin could not delete'; end if;
  raise notice 'TEST 85 PASS  only an admin deletes an incident';
end $$;

select 'ALL GUEST INCIDENT TESTS PASSED' as result;
