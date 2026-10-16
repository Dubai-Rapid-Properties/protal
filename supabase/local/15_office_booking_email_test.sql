-- ============================================================================
-- D|R|P PMS - Office booking emails switched off by default (0038)
--
-- Runs after 02-14 and reuses unit 2807 (valid DET permit, owner B). Earlier
-- suites switch office emails on to check their wording; this one checks the
-- switch itself and leaves it off, the default.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/15_office_booking_email_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  b uuid;
  c uuid;
begin
  -- TEST 120 - off: staff still get the portal notification, the office no email.
  update company_settings set email_office_about_bookings = false where id;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 460, current_date + 462, 1)
  returning id into b;
  if not exists (select 1 from notifications n join profiles p on p.id = n.recipient_id
                  where n.booking_id = b and p.email = 'admin@drp.ae') then
    raise exception 'TEST 120 FAILED: super admin not notified in the portal';
  end if;
  if exists (select 1 from messages where booking_id = b and party_kind = 'staff') then
    raise exception 'TEST 120 FAILED: office email queued while switched off';
  end if;
  raise notice 'TEST 120 PASS  office booking email off: portal notification only';

  -- TEST 121 - on: the office is emailed again.
  update company_settings set email_office_about_bookings = true where id;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 462, current_date + 464, 1)
  returning id into c;
  if not exists (select 1 from messages where booking_id = c and party_kind = 'staff'
                  and to_address = 'office@drp-test.ae') then
    raise exception 'TEST 121 FAILED: office not emailed when switched on';
  end if;
  raise notice 'TEST 121 PASS  office booking email sent when switched on';

  update company_settings set email_office_about_bookings = false where id;
  delete from bookings where id in (b, c);
end $$;

select 'ALL OFFICE BOOKING EMAIL TESTS PASSED' as result;
