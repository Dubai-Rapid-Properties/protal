-- ============================================================================
-- D|R|P PMS - finished channel blocks are kept (0041)
--
-- A channel feed lists current and future periods only, so a block that has
-- ended drops out of it. It must stay in the portal as history (it is how a
-- direct guest's stay shows); a future block that drops out is still removed.
--
-- Runs after 04 and reuses unit 2807.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/18_keep_past_channel_blocks_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- TEST 130 - a past block missing from the feed is kept, a future one removed.
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid := (select id from units where unit_number = '2807');
  r jsonb;
  past_left integer;
  future_left integer;
begin
  insert into availability_blocks (unit_id, start_date, end_date, reason, source_channel, ical_uid, note)
  values (u, current_date - 20, current_date - 15, 'channel_sync', 'airbnb', 'past-direct@airbnb.com', 'Not available on Airbnb'),
         (u, current_date + 30, current_date + 33, 'channel_sync', 'airbnb', 'future-gone@airbnb.com', 'Not available on Airbnb');

  -- The feed no longer lists either block (one live event keeps it from being empty).
  r := apply_channel_ical(u, 'airbnb', jsonb_build_array(jsonb_build_object(
    'uid', 'still-there@airbnb.com', 'start', current_date + 60, 'end', current_date + 62, 'kind', 'blocked', 'code', null)));

  select count(*) into past_left from availability_blocks where ical_uid = 'past-direct@airbnb.com';
  select count(*) into future_left from availability_blocks where ical_uid = 'future-gone@airbnb.com';
  if past_left <> 1 or future_left <> 0 then
    raise exception 'TEST 130 FAILED: past kept=% future kept=% (%)', past_left, future_left, r;
  end if;
  raise notice 'TEST 130 PASS  finished channel block kept as history, future one removed';

  delete from availability_blocks where ical_uid in ('past-direct@airbnb.com', 'still-there@airbnb.com');
end $$;

select 'ALL KEEP-PAST-CHANNEL-BLOCK TESTS PASSED' as result;
