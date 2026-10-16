-- ============================================================================
-- D|R|P PMS - office@dubairapidproperties.com is never emailed (0040)
--
-- Runs after 02-16 and reuses unit 2807 (valid DET permit, owner B).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/17_never_email_office_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  v_was  text := (select email from company_settings where id);
  b uuid;
  n integer;
begin
  -- TEST 128 - the office booking email is switched on, but the company
  -- address is the office's: nothing is queued for it.
  update company_settings set email = 'Office@DubaiRapidProperties.com', email_office_about_bookings = true where id;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 466, current_date + 468, 1)
  returning id into b;
  if exists (select 1 from messages where booking_id = b and pms.never_emailed(to_address)) then
    raise exception 'TEST 128 FAILED: an email to the office was queued';
  end if;
  raise notice 'TEST 128 PASS  booking email to the office address is not queued';

  -- TEST 129 - any email to it, however written, is not stored; others are.
  insert into messages (channel, status, party_kind, to_address, subject, body)
  values ('email', 'queued', 'staff', ' OFFICE@dubairapidproperties.com ', 'Test', 'Body'),
         ('email', 'queued', 'staff', 'someone@drp-test.ae', 'Test', 'Body');
  select count(*) into n from messages where subject = 'Test' and body = 'Body';
  if n <> 1 or not exists (select 1 from messages where to_address = 'someone@drp-test.ae') then
    raise exception 'TEST 129 FAILED: % test emails stored', n;
  end if;
  raise notice 'TEST 129 PASS  emails to the office address are not stored, others are';

  delete from messages where subject = 'Test' and body = 'Body';
  update company_settings set email = v_was, email_office_about_bookings = false where id;
  delete from bookings where id = b;
end $$;

select 'ALL NEVER-EMAIL-THE-OFFICE TESTS PASSED' as result;
