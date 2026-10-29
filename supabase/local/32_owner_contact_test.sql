-- ============================================================================
-- D|R|P PMS - Reminders to contact the owner about a ticket (0065)
--
-- Runs after 02. Raises its own tickets on unit 1204 and removes them again.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/32_owner_contact_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_unit uuid := (select id from units where unit_number = '1204' limit 1);
  v_new uuid;
  v_old uuid;
  v_done uuid;
  n int;
begin
  -- TEST 320 - a new ticket waits for the owner to be contacted; older ones are not chased.
  update maintenance_requests set owner_contact = null where owner_contact = 'pending';
  insert into maintenance_requests (ticket_number, unit_id, kind, category, priority, title, raised_by_kind)
  values ('', v_unit, 'repair', 'plumbing', 'high', 'Owner contact test: leak', 'staff')
  returning id into v_new;
  if (select owner_contact from maintenance_requests where id = v_new) is distinct from 'pending' then
    raise exception 'TEST 320 FAILED: a new ticket is not waiting for the owner to be contacted';
  end if;
  raise notice 'TEST 320 PASS  a new ticket starts as "owner not contacted"';

  -- TEST 321 - nothing is due in the first two hours.
  if exists (select 1 from claim_owner_contact_reminders() c where c.id = v_new) then
    raise exception 'TEST 321 FAILED: reminded before two hours';
  end if;
  raise notice 'TEST 321 PASS  no reminder in the first two hours';

  -- TEST 322 - after two hours it is due once, then again two hours after that.
  update maintenance_requests set created_at = now() - interval '2 hours 5 minutes' where id = v_new;
  select count(*) into n from claim_owner_contact_reminders() c where c.id = v_new and c.reminders_sent = 1;
  if n <> 1 then raise exception 'TEST 322 FAILED: first reminder not claimed (%)', n; end if;
  if exists (select 1 from claim_owner_contact_reminders() c where c.id = v_new) then
    raise exception 'TEST 322 FAILED: the same reminder was claimed twice';
  end if;
  update maintenance_requests set owner_reminded_at = now() - interval '2 hours 1 minute' where id = v_new;
  select count(*) into n from claim_owner_contact_reminders() c where c.id = v_new and c.reminders_sent = 2;
  if n <> 1 then raise exception 'TEST 322 FAILED: second reminder not claimed'; end if;
  raise notice 'TEST 322 PASS  reminded every two hours, never twice for the same slot';

  -- TEST 323 - marked contacted: no more reminders. "Not yet" brings them back.
  update maintenance_requests set owner_contact = 'contacted', owner_reminded_at = now() - interval '5 hours' where id = v_new;
  if exists (select 1 from claim_owner_contact_reminders() c where c.id = v_new) then
    raise exception 'TEST 323 FAILED: reminded after the owner was contacted';
  end if;
  update maintenance_requests set owner_contact = 'pending' where id = v_new;
  if not exists (select 1 from claim_owner_contact_reminders() c where c.id = v_new) then
    raise exception 'TEST 323 FAILED: "not yet" did not bring the reminders back';
  end if;
  raise notice 'TEST 323 PASS  "contacted" stops the reminders, "not yet" restarts them';

  -- TEST 324 - closed tickets and tickets from before the migration are not chased.
  insert into maintenance_requests (ticket_number, unit_id, kind, category, priority, title, raised_by_kind, status, created_at)
  values ('', v_unit, 'complaint', 'noise', 'low', 'Owner contact test: closed', 'staff', 'cancelled', now() - interval '1 day')
  returning id into v_done;
  insert into maintenance_requests (ticket_number, unit_id, kind, category, priority, title, raised_by_kind, created_at, owner_contact)
  values ('', v_unit, 'repair', 'other', 'low', 'Owner contact test: old', 'staff', now() - interval '1 day', null)
  returning id into v_old;
  if exists (select 1 from claim_owner_contact_reminders() c where c.id in (v_done, v_old)) then
    raise exception 'TEST 324 FAILED: a closed or old ticket was reminded';
  end if;
  raise notice 'TEST 324 PASS  closed and older tickets are left alone';

  -- TEST 325 - only the scheduler (service role) may claim reminders.
  if has_function_privilege('authenticated', 'claim_owner_contact_reminders(interval)', 'execute')
     or has_function_privilege('anon', 'claim_owner_contact_reminders(interval)', 'execute') then
    raise exception 'TEST 325 FAILED: signed-in users can claim reminders';
  end if;
  raise notice 'TEST 325 PASS  only the scheduler claims reminders';

  delete from maintenance_requests where id in (v_new, v_old, v_done);
end $$;
