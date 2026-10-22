-- ============================================================================
-- D|R|P PMS - 0045 Accounts without alarms
--
-- Some staff should see everything a super admin sees, and still get the
-- portal's notifications, but never an alarm: no Airbnb block alarm (0037),
-- no check-out / check-in rings (0042, 0044) and nothing on their phone
-- (0043). profiles.alarms_off turns all of those off for one account.
--
--   update profiles set alarms_off = true where email = '...';
-- ============================================================================

alter table profiles
  add column if not exists alarms_off boolean not null default false;

comment on column profiles.alarms_off is
  'No alarms for this account: no Airbnb block alarm, check-out / check-in rings or phone alarms. Notifications still arrive.';

create or replace function pms.my_alarms_off()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce((select alarms_off from profiles where id = auth.uid()), false);
$$;

-- 0042: who hears the check-out / check-in alarm for a unit
create or replace function pms.hears_stay_alarm(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select not pms.my_alarms_off()
     and (pms.my_role() = 'super_admin'
          or (pms.my_role() = 'maintenance' and pms.staff_scoped_to_unit(p_unit_id)));
$$;

-- 0037, unchanged but for the last condition
create or replace function pending_airbnb_blocks()
returns table (
  booking_id uuid,
  booking_number text,
  unit_id uuid,
  unit_label text,
  guest_name text,
  check_in date,
  check_out date,
  status booking_status,
  booked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select b.id, b.booking_number, u.id, p.name || ' · ' || u.unit_number,
         g.full_name, b.check_in, b.check_out, b.status, b.created_at
    from bookings b
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
   where pms.my_role() = 'super_admin'
     and not pms.my_alarms_off()
     and b.website_ref is not null
     and b.airbnb_block_done_at is null
     and b.status in ('tentative','confirmed','checked_in')
     and b.check_out > (now() at time zone 'Asia/Dubai')::date
     and u.airbnb_ical_url is not null
   order by b.created_at;
$$;

-- 0044, unchanged but for "and not pr.alarms_off"
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
    join profiles pr on pr.is_active and not pr.alarms_off
     and ((pr.role = 'super_admin' and r.kind <> 'prepare')
          or (pr.role = 'maintenance' and (
                exists (select 1 from staff_unit_assignments sua
                         where sua.profile_id = pr.id and sua.unit_id = u.id)
             or exists (select 1 from staff_property_assignments spa
                         where spa.profile_id = pr.id and spa.property_id = u.property_id))))
    join push_subscriptions s on s.profile_id = pr.id;
$$;

revoke all on function pms.my_alarms_off() from public, anon;
grant execute on function pms.my_alarms_off() to authenticated;
