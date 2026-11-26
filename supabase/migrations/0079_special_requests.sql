-- ============================================================================
-- D|R|P PMS - 0079 Special requests, with an alarm
--
-- A guest asks for something the unit does not normally have: a crib, spare
-- sheets for a third guest, a birthday cake. Staff write it on the booking,
-- and from 10:00 Dubai time the day before check-in (or at once, when the
-- guest arrives sooner) it rings - in the portal and on the phone - for super
-- admins and the unit's housekeeping, until someone presses "Done".
--
--   * bookings.special_requests: what the guest asked for.
--   * bookings.special_requests_done_at / _by: someone pressed "Done".
--     Changing the requests clears it, so a new request rings again.
--   * pms.due_stay_rings(): a fourth kind of ring, 'request'.
--   * due_stay_alarms() and stay_alarm_pushes() say what was asked (note);
--     ack_stay_alarm() answers it.
-- ============================================================================

alter table bookings
  add column if not exists special_requests text,
  add column if not exists special_requests_done_at timestamptz,
  add column if not exists special_requests_done_by uuid references profiles(id) on delete set null;

comment on column bookings.special_requests is
  'What the guest asked for (crib, spare sheets ...). Rings from 10:00 the day before check-in until Done.';
comment on column bookings.special_requests_done_at is
  'Someone pressed Done on the special requests alarm. Cleared when the requests change.';

-- A changed request is a new one: it rings again.
create or replace function pms.reset_special_requests_done()
returns trigger
language plpgsql
as $$
begin
  if new.special_requests is distinct from old.special_requests then
    new.special_requests_done_at := null;
    new.special_requests_done_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_special_requests_changed on bookings;
create trigger bookings_special_requests_changed
  before update of special_requests on bookings
  for each row execute function pms.reset_special_requests_done();

-- 0048, with the special requests ring
create or replace function pms.due_stay_rings(p_at timestamptz)
returns table (booking_id uuid, unit_id uuid, kind text, stage smallint)
language sql
stable
security definer
set search_path = public, pms
as $$
  with dubai as (
    select (p_at at time zone 'Asia/Dubai')::date as today,
           (p_at at time zone 'Asia/Dubai')::time as clock
  ),
  rings as (
    select b.id, b.unit_id, 'check_out'::text as kind,
           (case when d.clock >= pms.stay_time('check_out', b.check_in_time, b.check_out_time) then 2
                 when d.clock >= pms.stay_time('check_out', b.check_in_time, b.check_out_time) - interval '1 hour' then 1
                 else 0 end)::smallint as stage,
           b.check_out_alarm_done as done
      from bookings b, dubai d
     where b.check_out = d.today
       and b.status in ('confirmed','checked_in','checked_out')
    union all
    select b.id, b.unit_id, 'check_in',
           (case when d.clock >= pms.stay_time('check_in', b.check_in_time, b.check_out_time) then 2
                 when d.clock >= pms.stay_time('check_in', b.check_in_time, b.check_out_time) - interval '1 hour' then 1
                 else 0 end)::smallint,
           b.check_in_alarm_done
      from bookings b, dubai d
     where b.check_in = d.today
       and b.status in ('confirmed','checked_in')
    union all
    /* The day before check-in, from 16:00: get the unit ready */
    select b.id, b.unit_id, 'prepare',
           (case when d.clock >= '16:00' then 1 else 0 end)::smallint,
           b.prepare_alarm_done
      from bookings b, dubai d
     where b.check_in = d.today + 1
       and b.status = 'confirmed'
    union all
    /* What the guest asked for: from 10:00 the day before check-in, and all of check-in day */
    select b.id, b.unit_id, 'request',
           (case when b.check_in = d.today or d.clock >= '10:00' then 1 else 0 end)::smallint,
           (case when b.special_requests_done_at is null then 0 else 1 end)::smallint
      from bookings b, dubai d
     where b.check_in in (d.today, d.today + 1)
       and b.status in ('confirmed','checked_in')
       and nullif(btrim(b.special_requests), '') is not null
  )
  select id, unit_id, kind, stage from rings where stage > done;
$$;

-- The time a ring talks about: prepare and request rings name the check-in time.
create or replace function pms.ring_due_at(p_kind text, p_check_in_time time, p_check_out_time time)
returns text
language sql
immutable
as $$
  select to_char(pms.stay_time(case when p_kind in ('prepare','request') then 'check_in' else p_kind end,
                               p_check_in_time, p_check_out_time), 'HH24:MI');
$$;

-- As 0048, with the request ring (super admins and housekeeping) and what was asked.
drop function if exists due_stay_alarms(timestamptz);
create function due_stay_alarms(p_at timestamptz default now())
returns table (
  booking_id uuid,
  booking_number text,
  unit_id uuid,
  unit_label text,
  guest_name text,
  kind text,
  stage smallint,
  due_at text,
  check_in date,
  note text
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select b.id, b.booking_number, u.id, p.name || ' · ' || u.unit_number,
         g.full_name, r.kind, r.stage,
         pms.ring_due_at(r.kind, b.check_in_time, b.check_out_time),
         b.check_in,
         case when r.kind in ('request','prepare') then nullif(btrim(b.special_requests), '') end
    from pms.due_stay_rings(p_at) r
    join bookings b on b.id = r.booking_id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
   where pms.hears_stay_alarm(r.unit_id)
     /* Getting units ready is housekeeping's alone */
     and (r.kind <> 'prepare' or pms.my_role() = 'maintenance')
   order by case r.kind when 'request' then 0 when 'check_out' then 1 when 'check_in' then 2 else 3 end,
            p.name, u.unit_number;
$$;

-- As 0048, with the request ring and what was asked.
drop function if exists stay_alarm_pushes(timestamptz);
create function stay_alarm_pushes(p_at timestamptz default now())
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  booking_id uuid,
  booking_number text,
  unit_label text,
  kind text,
  stage smallint,
  due_at text,
  check_in date,
  guest_name text,
  note text
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select s.id, s.endpoint, s.p256dh, s.auth, b.id, b.booking_number,
         p.name || ' · ' || u.unit_number, r.kind, r.stage,
         pms.ring_due_at(r.kind, b.check_in_time, b.check_out_time),
         b.check_in, g.full_name,
         case when r.kind in ('request','prepare') then nullif(btrim(b.special_requests), '') end
    from pms.due_stay_rings(p_at) r
    join bookings b on b.id = r.booking_id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
    join profiles pr on pr.is_active and not pr.alarms_off
     and ((pr.role = 'super_admin' and r.kind <> 'prepare')
          or (pr.role = 'maintenance' and (
                exists (select 1 from staff_unit_assignments sua
                         where sua.profile_id = pr.id and sua.unit_id = u.id)
             or exists (select 1 from staff_property_assignments spa
                         where spa.profile_id = pr.id and spa.property_id = u.property_id))))
    join push_subscriptions s on s.profile_id = pr.id;
$$;

-- 0044, with the request ring
create or replace function ack_stay_alarm(p_booking_id uuid, p_kind text, p_stage smallint)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_unit uuid := (select unit_id from bookings where id = p_booking_id);
begin
  if v_unit is null or not pms.hears_stay_alarm(v_unit) then
    raise exception 'Only a super admin or housekeeping can do this' using errcode = 'insufficient_privilege';
  end if;
  if p_stage not in (1, 2) then
    raise exception 'Unknown alarm stage %', p_stage using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'check_out' then
    update bookings
       set check_out_alarm_done = greatest(check_out_alarm_done, p_stage), check_out_alarm_done_by = auth.uid()
     where id = p_booking_id;
  elsif p_kind = 'check_in' then
    update bookings
       set check_in_alarm_done = greatest(check_in_alarm_done, p_stage), check_in_alarm_done_by = auth.uid()
     where id = p_booking_id;
  elsif p_kind = 'prepare' then
    update bookings
       set prepare_alarm_done = 1, prepare_alarm_done_by = auth.uid()
     where id = p_booking_id;
  elsif p_kind = 'request' then
    update bookings
       set special_requests_done_at = now(), special_requests_done_by = auth.uid()
     where id = p_booking_id
       and special_requests_done_at is null;
  else
    raise exception 'Unknown alarm kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function due_stay_alarms(timestamptz) from public, anon;
grant execute on function due_stay_alarms(timestamptz) to authenticated;
revoke all on function stay_alarm_pushes(timestamptz) from public, anon, authenticated;
grant execute on function stay_alarm_pushes(timestamptz) to service_role;
