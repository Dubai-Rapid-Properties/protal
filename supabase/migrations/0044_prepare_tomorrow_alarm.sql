-- ============================================================================
-- D|R|P PMS - 0044 Alarm: tomorrow's check-ins, for housekeeping
--
-- Housekeeping prepares a unit (bed sheets, towels) the day before a guest
-- arrives. From 16:00 Dubai time, every stay that checks in tomorrow rings
-- for housekeeping - in the portal and on their phone - until they press
-- "Done". Housekeeping (maintenance) only, for the units assigned to them:
-- super admins do not hear it.
--
--   * bookings.prepare_alarm_done / _by: answered (1) and by whom.
--   * pms.due_stay_rings(): a third kind of ring, 'prepare', for check-ins
--     tomorrow; due_stay_alarms() and stay_alarm_pushes() give it to
--     housekeeping only; ack_stay_alarm() answers it.
-- ============================================================================

alter table bookings
  add column if not exists prepare_alarm_done smallint not null default 0,
  add column if not exists prepare_alarm_done_by uuid references profiles(id) on delete set null;

comment on column bookings.prepare_alarm_done is
  'Housekeeping answered the 16:00 ring the day before check-in (1), Dubai time.';

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
           (case when d.clock >= '12:00' then 2
                 when d.clock >= '11:00' then 1
                 else 0 end)::smallint as stage,
           b.check_out_alarm_done as done
      from bookings b, dubai d
     where b.check_out = d.today
       and b.status in ('confirmed','checked_in','checked_out')
    union all
    select b.id, b.unit_id, 'check_in',
           (case when d.clock >= '15:00' then 2
                 when d.clock >= '14:00' then 1
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
  )
  select id, unit_id, kind, stage from rings where stage > done;
$$;

create or replace function due_stay_alarms(p_at timestamptz default now())
returns table (
  booking_id uuid,
  booking_number text,
  unit_id uuid,
  unit_label text,
  guest_name text,
  kind text,
  stage smallint,
  due_at text
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select b.id, b.booking_number, u.id, p.name || ' · ' || u.unit_number,
         g.full_name, r.kind, r.stage,
         case r.kind when 'check_out' then '12:00' else '15:00' end
    from pms.due_stay_rings(p_at) r
    join bookings b on b.id = r.booking_id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
   where pms.hears_stay_alarm(r.unit_id)
     /* Getting units ready is housekeeping's alone */
     and (r.kind <> 'prepare' or pms.my_role() = 'maintenance')
   order by case r.kind when 'check_out' then 0 when 'check_in' then 1 else 2 end, p.name, u.unit_number;
$$;

create or replace function stay_alarm_pushes(p_at timestamptz default now())
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
  due_at text
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select s.id, s.endpoint, s.p256dh, s.auth, b.id, b.booking_number,
         p.name || ' · ' || u.unit_number, r.kind, r.stage,
         case r.kind when 'check_out' then '12:00' else '15:00' end
    from pms.due_stay_rings(p_at) r
    join bookings b on b.id = r.booking_id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    join profiles pr on pr.is_active
     and ((pr.role = 'super_admin' and r.kind <> 'prepare')
          or (pr.role = 'maintenance' and (
                exists (select 1 from staff_unit_assignments sua
                         where sua.profile_id = pr.id and sua.unit_id = u.id)
             or exists (select 1 from staff_property_assignments spa
                         where spa.profile_id = pr.id and spa.property_id = u.property_id))))
    join push_subscriptions s on s.profile_id = pr.id;
$$;

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
  else
    raise exception 'Unknown alarm kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;
