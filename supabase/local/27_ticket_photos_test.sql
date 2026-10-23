-- ============================================================================
-- D|R|P PMS - Photos on repairs and complaints (0053)
--
-- Runs after 02. Uses the smoke test's tickets on unit 1204 (owner A) and
-- leaves them as they were.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/27_ticket_photos_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.add_as(who uuid, ticket uuid, path text) returns text
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  perform add_ticket_photo(ticket, path);
  perform set_config('role', 'postgres', true);
  return 'ok';
exception when others then
  perform set_config('role', 'postgres', true);
  return sqlstate;
end $$;

do $$
declare
  owner_a uuid := '33333333-3333-3333-3333-333333333333';
  owner_b uuid := '44444444-4444-4444-4444-444444444444';
  admin uuid := '11111111-1111-1111-1111-111111111111';
  v_ticket uuid := (select m.id from maintenance_requests m join units u on u.id = m.unit_id
                     where u.unit_number = '1204' order by m.reported_at limit 1);
  before text[] := (select photo_paths from maintenance_requests where id = v_ticket);
  t text;
begin
  -- TEST 270 - the unit's owner and staff add photos to its ticket.
  t := pg_temp.add_as(owner_a, v_ticket, 'ticket/' || v_ticket || '/1-leak.jpg');
  if t <> 'ok' then raise exception 'TEST 270 FAILED (owner): %', t; end if;
  t := pg_temp.add_as(admin, v_ticket, 'ticket/' || v_ticket || '/2-leak.jpg');
  if t <> 'ok' or (select cardinality(photo_paths) from maintenance_requests where id = v_ticket)
                  <> coalesce(cardinality(before), 0) + 2 then
    raise exception 'TEST 270 FAILED (staff): %', t;
  end if;
  raise notice 'TEST 270 PASS  owner and staff add photos to a ticket';

  -- TEST 271 - another owner cannot, nor can a path outside the ticket's folder be added.
  t := pg_temp.add_as(owner_b, v_ticket, 'ticket/' || v_ticket || '/3-x.jpg');
  if t <> '42501' then raise exception 'TEST 271 FAILED (other owner): %', t; end if;
  t := pg_temp.add_as(admin, v_ticket, 'incident/' || v_ticket || '/x.jpg');
  if t <> '22023' then raise exception 'TEST 271 FAILED (path): %', t; end if;
  raise notice 'TEST 271 PASS  other owners and foreign paths are refused';

  update maintenance_requests set photo_paths = before where id = v_ticket;
end $$;
