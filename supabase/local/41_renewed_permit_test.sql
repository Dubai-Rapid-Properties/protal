-- ============================================================================
-- D|R|P PMS - A renewed DET permit stops raising compliance alerts (0078)
--
-- Runs after 02. Adds its own unit and permits, relative to today, and
-- removes them.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/41_renewed_permit_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_a uuid := (select id from units where unit_number = '2807');
  v_unit uuid;
  v_old uuid;
begin
  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms, size_sqft,
                     furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  select property_id, '2814', 'DRP-MG1-2814', 'apartment', 1, 1, 700, 'fully_furnished', 'short_term', 600, 2
    from units where id = v_a
  returning id into v_unit;
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification, issued_on, expires_on, status,
                                    noc_reference, noc_expires_on)
  values (v_unit, 'OLD-2814', 'D|R|P Holiday Homes', 'Standard', current_date - 365, current_date, 'active', 'NOC-OLD', current_date)
  returning id into v_old;

  -- TEST 410 - expiring today with no renewal: flagged.
  if not exists (select 1 from v_compliance_calendar where entity_id = v_old and kind = 'det_permit_expiry') then
    raise exception 'TEST 410 FAILED: an expiring permit is not flagged';
  end if;
  raise notice 'TEST 410 PASS  a permit expiring without a renewal is flagged';

  -- TEST 411 - renewed: neither the old permit nor its NOC is flagged any more.
  insert into holiday_home_permits (unit_id, permit_number, operator_name, det_classification, issued_on, expires_on, status)
  values (v_unit, 'NEW-2814', 'D|R|P Holiday Homes', 'Standard', current_date, current_date + 365, 'active');
  if exists (select 1 from v_compliance_calendar where entity_id = v_old) then
    raise exception 'TEST 411 FAILED: the renewed permit is still flagged';
  end if;
  raise notice 'TEST 411 PASS  a renewed permit and its NOC are no longer flagged';

  delete from holiday_home_permits where unit_id = v_unit;
  delete from units where id = v_unit;
end $$;
