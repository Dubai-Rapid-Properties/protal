-- ============================================================================
-- D|R|P PMS - 0048 Early check-in and late check-out
--
-- Guests arrive from 15:00 and leave by 12:00 - unless staff agree an early
-- check-in or a late check-out. bookings.check_in_time / check_out_time
-- (0005) hold the agreed time; empty means the standard one.
--
--   * The check-in and check-out alarms (0042-0045) ring an hour ahead of
--     and at the stay's own time, and say that time.
--   * The stay's turnover clean, not yet started, starts at the guest's
--     check-out time on the check-out day, and follows a change of either.
-- ============================================================================

-- The time a stay checks in or out, Dubai time: its own, or the standard.
create or replace function pms.stay_time(p_kind text, p_check_in_time time, p_check_out_time time)
returns time
language sql
immutable
as $$
  select case p_kind
           when 'check_out' then coalesce(p_check_out_time, time '12:00')
           when 'check_in' then coalesce(p_check_in_time, time '15:00')
           /* The day-before ring for housekeeping */
           else time '16:00'
         end;
$$;

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
  )
  select id, unit_id, kind, stage from rings where stage > done;
$$;

-- As 0044, saying each stay's own time.
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
         to_char(pms.stay_time(case r.kind when 'prepare' then 'check_in' else r.kind end,
                               b.check_in_time, b.check_out_time), 'HH24:MI')
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

-- As 0045, saying each stay's own time.
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
         to_char(pms.stay_time(case r.kind when 'prepare' then 'check_in' else r.kind end,
                               b.check_in_time, b.check_out_time), 'HH24:MI')
    from pms.due_stay_rings(p_at) r
    join bookings b on b.id = r.booking_id
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    join profiles pr on pr.is_active and not pr.alarms_off
     and ((pr.role = 'super_admin' and r.kind <> 'prepare')
          or (pr.role = 'maintenance' and (
                exists (select 1 from staff_unit_assignments sua
                         where sua.profile_id = pr.id and sua.unit_id = u.id)
             or exists (select 1 from staff_property_assignments spa
                         where spa.profile_id = pr.id and spa.property_id = u.property_id))))
    join push_subscriptions s on s.profile_id = pr.id;
$$;


-- ---------------------------------------------------------------------------
-- The turnover clean follows the guest's check-out day and time. Runs after
-- bookings_schedule_turnover (triggers fire in name order), so it also sets
-- a clean that trigger has just created.
-- ---------------------------------------------------------------------------
create or replace function pms.align_turnover()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_start timestamptz;
begin
  -- A late check-out moves the clean to the guest's leaving time; the
  -- standard clean starts at 11:00 (0011).
  v_start := (new.check_out + greatest(time '11:00', coalesce(new.check_out_time, time '11:00')))
             at time zone 'Asia/Dubai';
  update housekeeping_tasks
     set scheduled_start = v_start,
         scheduled_end   = v_start + interval '4 hours'
   where booking_id = new.id
     and kind = 'turnover'
     and status in ('pending','assigned')
     and scheduled_start is distinct from v_start;
  return new;
end;
$$;

drop trigger if exists bookings_turnover_time on bookings;
create trigger bookings_turnover_time
  after insert or update of status, check_out, check_out_time on bookings
  for each row execute function pms.align_turnover();
