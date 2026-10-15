-- ============================================================================
-- D|R|P PMS - Guest incident status and comments (0039)
--
-- Runs after 02-15 and reuses their fixtures: unit 2807 (owner B, assigned to
-- the property manager).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/16_incident_updates_test.sql
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
  v_pm    uuid := '22222222-2222-2222-2222-222222222222';
  v_2807  uuid := (select id from units where unit_number = '2807');
  v_inc   uuid;
  n       integer;
  r       guest_incidents%rowtype;
  u       guest_incident_updates%rowtype;
begin
  perform pg_temp.act_as(v_pm);
  insert into guest_incidents (unit_id, category, description, reported_by)
  values (v_2807, 'damage', 'Broken coffee table.', v_pm)
  returning id into v_inc;

  -- TEST 122 - a status change goes on the timeline with its comment.
  perform set_guest_incident_status(v_inc, 'in_progress', 'Carpenter booked for Monday.');
  select * into r from guest_incidents where id = v_inc;
  select * into u from guest_incident_updates where incident_id = v_inc;
  get diagnostics n = row_count;
  perform pg_temp.act_as_postgres();
  if r.status <> 'in_progress' then raise exception 'TEST 122 FAILED: status is %', r.status; end if;
  if n <> 1 or u.status_from <> 'open' or u.status_to <> 'in_progress'
     or u.note <> 'Carpenter booked for Monday.' or u.author_id <> v_pm then
    raise exception 'TEST 122 FAILED: timeline entry wrong (% rows, % -> %, %, by %)',
      n, u.status_from, u.status_to, u.note, u.author_id;
  end if;
  raise notice 'TEST 122 PASS  a status change and its comment go on the timeline';

  -- TEST 123 - closed is finished like resolved; reopening clears the time.
  perform pg_temp.act_as(v_pm);
  perform set_guest_incident_status(v_inc, 'closed');
  select * into r from guest_incidents where id = v_inc;
  perform pg_temp.act_as_postgres();
  if r.resolved_at is null then raise exception 'TEST 123 FAILED: closing did not stamp the time'; end if;
  perform pg_temp.act_as(v_pm);
  perform set_guest_incident_status(v_inc, 'awaiting_payment');
  select * into r from guest_incidents where id = v_inc;
  perform pg_temp.act_as_postgres();
  if r.resolved_at is not null then raise exception 'TEST 123 FAILED: time kept after reopening'; end if;
  raise notice 'TEST 123 PASS  closing stamps the finish time, reopening clears it';

  -- TEST 124 - the same status adds nothing; with a comment, only the comment.
  perform pg_temp.act_as(v_pm);
  perform set_guest_incident_status(v_inc, 'awaiting_payment');
  select count(*) into n from guest_incident_updates where incident_id = v_inc;
  if n <> 3 then
    perform pg_temp.act_as_postgres();
    raise exception 'TEST 124 FAILED: % entries after an unchanged status', n;
  end if;
  perform set_guest_incident_status(v_inc, 'awaiting_payment', 'Guest says he will pay Friday.');
  -- One transaction, so every entry has the same time: find it by its note.
  select * into u from guest_incident_updates where incident_id = v_inc and note like 'Guest says%';
  select count(*) into n from guest_incident_updates where incident_id = v_inc;
  perform pg_temp.act_as_postgres();
  if n <> 4 or u.status_to is not null or u.note <> 'Guest says he will pay Friday.' then
    raise exception 'TEST 124 FAILED: % entries, last % / %', n, u.status_to, u.note;
  end if;
  raise notice 'TEST 124 PASS  an unchanged status adds nothing; a comment alone is a comment';

  -- TEST 125 - staff comment as themselves only.
  perform pg_temp.act_as(v_pm);
  insert into guest_incident_updates (incident_id, note) values (v_inc, 'Photos sent to Airbnb.');
  begin
    insert into guest_incident_updates (incident_id, author_id, note)
    values (v_inc, '11111111-1111-1111-1111-111111111111', 'Pretending to be the admin');
    raise exception 'TEST 125 FAILED: comment saved under someone else''s name';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_postgres();
  raise notice 'TEST 125 PASS  staff comment under their own name only';

  -- TEST 126 - owners and tenants see no timeline and cannot add to it.
  perform pg_temp.act_as('44444444-4444-4444-4444-444444444444');
  select count(*) into n from guest_incident_updates;
  if n <> 0 then
    perform pg_temp.act_as_postgres();
    raise exception 'TEST 126 FAILED: owner B reads % entries on their own unit', n;
  end if;
  begin
    insert into guest_incident_updates (incident_id, note) values (v_inc, 'Owner comment');
    raise exception 'TEST 126 FAILED: owner commented';
  exception when insufficient_privilege then null;
  end;
  begin
    perform set_guest_incident_status(v_inc, 'resolved');
    raise exception 'TEST 126 FAILED: owner changed the status';
  exception when no_data_found then null;
  end;
  perform pg_temp.act_as('55555555-5555-5555-5555-555555555555');
  select count(*) into n from guest_incident_updates;
  perform pg_temp.act_as_postgres();
  if n <> 0 then raise exception 'TEST 126 FAILED: tenant reads % entries', n; end if;
  raise notice 'TEST 126 PASS  owners and tenants cannot read or add to the timeline';

  -- TEST 127 - only the known statuses.
  perform pg_temp.act_as(v_pm);
  begin
    perform set_guest_incident_status(v_inc, 'forgotten');
    raise exception 'TEST 127 FAILED: unknown status accepted';
  exception when check_violation then null;
  end;
  perform pg_temp.act_as_postgres();
  raise notice 'TEST 127 PASS  an unknown status is refused';

  delete from guest_incidents where id = v_inc;
end $$;

select 'ALL INCIDENT STATUS AND COMMENT TESTS PASSED' as result;
