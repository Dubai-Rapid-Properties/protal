-- ============================================================================
-- D|R|P PMS - Removing a "Blocked on Airbnb" period (0035)
--
-- Runs after 02-11 and reuses unit 2807 (property manager assigned, owner B).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/12_dismiss_airbnb_block_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.feed(uid text, s integer, e integer) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object('uid', uid, 'start', current_date + s, 'end', current_date + e, 'kind', 'blocked'))
$$;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  v_block uuid;
  n integer;
begin
  perform apply_channel_ical(v_unit, 'airbnb', pg_temp.feed('dismiss-1@airbnb.com', 300, 310));
  select id into v_block from availability_blocks where ical_uid = 'dismiss-1@airbnb.com';
  if v_block is null then raise exception 'TEST 90 FAILED: block not synced'; end if;

  -- TEST 90 - an owner cannot remove it.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  begin
    perform dismiss_channel_block(v_block);
    raise exception 'TEST 90 FAILED: owner removed an Airbnb block';
  exception when no_data_found or insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from availability_blocks where id = v_block) then
    raise exception 'TEST 90 FAILED: block gone after the owner tried';
  end if;
  raise notice 'TEST 90 PASS  owners cannot remove an Airbnb block';

  -- TEST 91 - staff remove it, and the next sync does not bring it back.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform dismiss_channel_block(v_block);
  perform apply_channel_ical(v_unit, 'airbnb', pg_temp.feed('dismiss-1@airbnb.com', 300, 310));
  perform set_config('role', 'postgres', true);
  select count(*) into n from availability_blocks where ical_uid = 'dismiss-1@airbnb.com';
  if n <> 0 then raise exception 'TEST 91 FAILED: removed block came back (% rows)', n; end if;
  raise notice 'TEST 91 PASS  removed Airbnb block stays removed through a sync';

  -- TEST 92 - when Airbnb changes its dates, it shows again.
  perform apply_channel_ical(v_unit, 'airbnb', pg_temp.feed('dismiss-1@airbnb.com', 300, 315));
  select count(*) into n from availability_blocks where ical_uid = 'dismiss-1@airbnb.com' and end_date = current_date + 315;
  if n <> 1 or exists (select 1 from channel_block_dismissals where ical_uid = 'dismiss-1@airbnb.com') then
    raise exception 'TEST 92 FAILED: changed block not shown again';
  end if;
  raise notice 'TEST 92 PASS  a changed Airbnb block shows again';

  -- TEST 93 - only synced blocks: an owner stay is not "dismissed" this way.
  insert into availability_blocks (unit_id, start_date, end_date, reason) values
    (v_unit, current_date + 330, current_date + 332, 'owner_stay') returning id into v_block;
  begin
    perform dismiss_channel_block(v_block);
    raise exception 'TEST 93 FAILED: owner stay dismissed as an Airbnb block';
  exception when no_data_found then null;
  end;
  delete from availability_blocks where id = v_block;
  delete from availability_blocks where ical_uid = 'dismiss-1@airbnb.com';
  raise notice 'TEST 93 PASS  only synced channel blocks can be dismissed';
end $$;

select 'ALL AIRBNB BLOCK REMOVAL TESTS PASSED' as result;
