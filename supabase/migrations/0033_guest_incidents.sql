-- ============================================================================
-- D|R|P PMS - 0033 Guest incidents (staff only)
--
-- A record of what a guest did to a unit: vomit or other mess, damage,
-- smoking, a party, extra guests, missing items. Kept for cleaning charges,
-- deposit deductions and Airbnb claims - and never shown to owners.
--
-- Repairs and complaints (maintenance_requests, 0019) are shared with the
-- unit's owner by design. Incidents are not, so they get their own table
-- whose every policy requires staff scoped to the unit; there is no owner,
-- tenant or guest path to a row, and no owner view over it.
--
-- Photos live in the private 'documents' bucket under incident/<id>/... with
-- no documents row: the bucket lets staff read any object and everyone else
-- only objects a documents row grants them, so these stay staff only too.
-- ============================================================================

create table guest_incidents (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete restrict,
  booking_id    uuid references bookings(id) on delete set null,
  occurred_on   date not null default current_date,
  category      text not null check (category in (
                  'vomit', 'mess', 'damage', 'smoking', 'party_noise',
                  'extra_guests', 'pets', 'missing_items', 'rule_breach', 'other')),
  description   text not null check (length(btrim(description)) between 3 and 4000),
  charge_aed    numeric(10,2) check (charge_aed >= 0),
  photo_paths   text[] not null default '{}',
  status        text not null default 'open' check (status in ('open', 'resolved')),
  resolution    text check (length(resolution) <= 2000),
  resolved_at   timestamptz,
  reported_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table guest_incidents is
  'What a guest did to a unit (mess, damage, smoking ...). Staff only - never shown to owners.';
comment on column guest_incidents.charge_aed is
  'What D|R|P means to recover from the guest or their deposit, if anything.';
comment on column guest_incidents.photo_paths is
  'Object keys in the private documents bucket (incident/<id>/...).';

create index guest_incidents_unit_idx on guest_incidents(unit_id, occurred_on desc);
create index guest_incidents_booking_idx on guest_incidents(booking_id);
create index guest_incidents_open_idx on guest_incidents(occurred_on desc) where status = 'open';

create trigger guest_incidents_touch before update on guest_incidents
  for each row execute function pms.touch_updated_at();

-- The stay must be on the same unit, and resolving stamps the time.
create or replace function pms.guest_incident_checks()
returns trigger
language plpgsql
set search_path = public, pms
as $$
begin
  if new.booking_id is not null
     and not exists (select 1 from bookings b where b.id = new.booking_id and b.unit_id = new.unit_id) then
    raise exception 'That booking is not on this unit' using errcode = 'check_violation';
  end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at := now();
  elsif new.status = 'open' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger guest_incidents_checks
  before insert or update on guest_incidents
  for each row execute function pms.guest_incident_checks();

alter table guest_incidents enable row level security;

create policy guest_incidents_read on guest_incidents
  for select to authenticated
  using (pms.is_staff() and pms.staff_scoped_to_unit(unit_id));

create policy guest_incidents_insert on guest_incidents
  for insert to authenticated
  with check (pms.is_staff() and pms.staff_scoped_to_unit(unit_id));

create policy guest_incidents_update on guest_incidents
  for update to authenticated
  using (pms.is_staff() and pms.staff_scoped_to_unit(unit_id))
  with check (pms.is_staff() and pms.staff_scoped_to_unit(unit_id));

create policy guest_incidents_delete on guest_incidents
  for delete to authenticated
  using (pms.is_admin());

revoke all on guest_incidents from public, anon;
grant select, insert, update, delete on guest_incidents to authenticated;
grant all on guest_incidents to service_role;
