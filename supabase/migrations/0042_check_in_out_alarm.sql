-- ============================================================================
-- D|R|P PMS - 0042 Alarm: today's check-outs (12:00) and check-ins (15:00)
--
-- Guests leave by 12:00 and arrive from 15:00, Dubai time, and housekeeping
-- turns each unit round in between. So the portal rings for every stay ending
-- or starting today, twice: an hour ahead (11:00 / 14:00) and at the time
-- itself (12:00 / 15:00). Each ring keeps sounding until someone presses
-- "Done"; the second ring sounds even if the first was answered.
--
--   * bookings.check_out_alarm_done / check_in_alarm_done: the last ring
--     answered (0 none, 1 the hour-ahead ring, 2 the ring on the time), and
--     _by whom.
--   * due_stay_alarms(): rings due now and not yet answered. Super admins
--     see every unit; housekeeping (maintenance) the units assigned to them.
--   * ack_stay_alarm(): "Done", for the same people.
-- ============================================================================

alter table bookings
  add column if not exists check_out_alarm_done smallint not null default 0,
  add column if not exists check_out_alarm_done_by uuid references profiles(id) on delete set null,
  add column if not exists check_in_alarm_done smallint not null default 0,
  add column if not exists check_in_alarm_done_by uuid references profiles(id) on delete set null;

comment on column bookings.check_out_alarm_done is
  'Check-out alarm answered: 0 none, 1 the 11:00 ring, 2 the 12:00 ring (Dubai time).';
comment on column bookings.check_in_alarm_done is
  'Check-in alarm answered: 0 none, 1 the 14:00 ring, 2 the 15:00 ring (Dubai time).';

-- Who hears the alarm for a unit.
create or replace function pms.hears_stay_alarm(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.my_role() = 'super_admin'
      or (pms.my_role() = 'maintenance' and pms.staff_scoped_to_unit(p_unit_id));
$$;

-- p_at is only there so tests can pick the moment; callers use now().
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
  )
  select b.id, b.booking_number, u.id, p.name || ' · ' || u.unit_number,
         g.full_name, r.kind, r.stage,
         case r.kind when 'check_out' then '12:00' else '15:00' end
    from rings r
    join bookings b on b.id = r.id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
   where r.stage > r.done
     and pms.hears_stay_alarm(r.unit_id)
   order by r.kind desc, p.name, u.unit_number;
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
  else
    raise exception 'Unknown alarm kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function pms.hears_stay_alarm(uuid) from public, anon;
revoke all on function due_stay_alarms(timestamptz) from public, anon;
revoke all on function ack_stay_alarm(uuid, text, smallint) from public, anon;
grant execute on function pms.hears_stay_alarm(uuid) to authenticated;
grant execute on function due_stay_alarms(timestamptz) to authenticated;
grant execute on function ack_stay_alarm(uuid, text, smallint) to authenticated;
