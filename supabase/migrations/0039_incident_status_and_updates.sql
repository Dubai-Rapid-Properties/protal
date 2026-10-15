-- ============================================================================
-- D|R|P PMS - 0039 Guest incidents: a status to follow up, and comments
--
-- An incident was only "open" or "resolved", with one "what was done" box.
-- Staff follow one up over days - cleaner booked, claim sent to Airbnb, money
-- awaited - so it now has:
--
--   * more statuses: open, in progress, waiting for payment, resolved, and
--     closed (nothing to charge). Resolved and closed are the finished ones
--     and stamp resolved_at;
--   * guest_incident_updates: comments, and every status change with who made
--     it and when - the incident's timeline. Staff only, like the incident;
--   * set_guest_incident_status(): changes the status and records it, with
--     an optional comment, in one step.
-- ============================================================================

alter table guest_incidents drop constraint if exists guest_incidents_status_check;
alter table guest_incidents add constraint guest_incidents_status_check
  check (status in ('open', 'in_progress', 'awaiting_payment', 'resolved', 'closed'));

drop index if exists guest_incidents_open_idx;
create index guest_incidents_open_idx on guest_incidents(occurred_on desc)
  where status not in ('resolved', 'closed');

-- The stay must be on the same unit; finishing stamps the time (0033, now
-- for closed as well as resolved).
create or replace function pms.guest_incident_checks()
returns trigger
language plpgsql
set search_path = public, pms
as $$
declare
  v_finished boolean := new.status in ('resolved', 'closed');
begin
  if new.booking_id is not null
     and not exists (select 1 from bookings b where b.id = new.booking_id and b.unit_id = new.unit_id) then
    raise exception 'That booking is not on this unit' using errcode = 'check_violation';
  end if;
  if v_finished and (tg_op = 'INSERT' or old.status not in ('resolved', 'closed')) then
    new.resolved_at := now();
  elsif not v_finished then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create table if not exists guest_incident_updates (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references guest_incidents(id) on delete cascade,
  author_id    uuid references profiles(id) on delete set null default auth.uid(),
  note         text check (length(btrim(note)) between 1 and 2000),
  status_from  text,
  status_to    text,
  created_at   timestamptz not null default now(),
  check (note is not null or status_to is not null)
);

comment on table guest_incident_updates is
  'Comments and status changes on a guest incident. Staff only - never shown to owners.';

create index if not exists guest_incident_updates_incident_idx
  on guest_incident_updates(incident_id, created_at);

alter table guest_incident_updates enable row level security;

-- Whoever may see the incident sees its timeline; every policy goes through
-- the incident, so there is no owner or tenant path to a row.
create policy guest_incident_updates_read on guest_incident_updates
  for select to authenticated
  using (pms.is_staff() and exists (
    select 1 from guest_incidents i
     where i.id = incident_id and pms.staff_scoped_to_unit(i.unit_id)));

create policy guest_incident_updates_insert on guest_incident_updates
  for insert to authenticated
  with check (author_id = auth.uid() and pms.is_staff() and exists (
    select 1 from guest_incidents i
     where i.id = incident_id and pms.staff_scoped_to_unit(i.unit_id)));

create policy guest_incident_updates_delete on guest_incident_updates
  for delete to authenticated
  using (pms.is_admin());

revoke all on guest_incident_updates from public, anon;
grant select, insert, delete on guest_incident_updates to authenticated;
grant all on guest_incident_updates to service_role;

-- Moves an incident to a status and puts it on the timeline, with an
-- optional comment. Runs as the caller, so the policies decide who may.
create or replace function set_guest_incident_status(p_incident_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security invoker
set search_path = public, pms
as $$
declare
  v_from text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_changed boolean;
begin
  select status into v_from from guest_incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = 'no_data_found';
  end if;

  v_changed := p_status is distinct from v_from;
  if not v_changed and v_note is null then
    return;
  end if;

  if v_changed then
    update guest_incidents set status = p_status where id = p_incident_id;
  end if;

  insert into guest_incident_updates (incident_id, note, status_from, status_to)
  values (p_incident_id, v_note,
          case when v_changed then v_from end,
          case when v_changed then p_status end);
end;
$$;

revoke all on function set_guest_incident_status(uuid, text, text) from public, anon;
grant execute on function set_guest_incident_status(uuid, text, text) to authenticated;
