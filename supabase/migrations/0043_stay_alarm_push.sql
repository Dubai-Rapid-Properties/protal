-- ============================================================================
-- D|R|P PMS - 0043 Check-out / check-in alarm on the phone, app closed
--
-- 0042 rings while the portal is open. This sends the same alarm as a phone
-- notification (Web Push), so it reaches housekeeping with the app closed.
-- Every two minutes the scheduler (/api/cron/stay-alarms) pushes each ring
-- nobody has answered to everyone who hears it, until someone presses "Done".
--
--   * push_subscriptions: the devices each person turned the alarm on for.
--     Only through save_/delete_push_subscription(); nobody reads them but
--     the server.
--   * push_vapid_keys: the portal's push signing key, made by the server on
--     first use. Server only.
--   * pms.due_stay_rings(): 0042's ring rules, now shared by
--     due_stay_alarms() (the banner) and stay_alarm_pushes() (the phones).
-- ============================================================================

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_profile_idx on push_subscriptions(profile_id);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;

create table if not exists push_vapid_keys (
  id          boolean primary key default true check (id),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table push_vapid_keys enable row level security;
revoke all on push_vapid_keys from anon, authenticated;

-- A device signs up (or moves to whoever is signed in on it now).
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if not pms.is_staff() then
    raise exception 'Only staff can turn on phone alarms' using errcode = 'insufficient_privilege';
  end if;
  if p_endpoint !~ '^https://' then
    raise exception 'Not a push address' using errcode = 'invalid_parameter_value';
  end if;
  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set profile_id = excluded.profile_id, p256dh = excluded.p256dh,
         auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

create or replace function delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public, pms
as $$
  delete from push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid();
$$;

-- Rings due at p_at that nobody has answered: check-out 11:00 / 12:00,
-- check-in 14:00 / 15:00, Dubai time (0042).
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
   order by r.kind desc, p.name, u.unit_number;
$$;

-- One row per (ring, device that should get it). For the scheduler, which
-- runs with the service key: who hears a ring is decided here per person,
-- the same way pms.hears_stay_alarm() decides it for the signed-in one.
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
     and (pr.role = 'super_admin'
          or (pr.role = 'maintenance' and (
                exists (select 1 from staff_unit_assignments sua
                         where sua.profile_id = pr.id and sua.unit_id = u.id)
             or exists (select 1 from staff_property_assignments spa
                         where spa.profile_id = pr.id and spa.property_id = u.property_id))))
    join push_subscriptions s on s.profile_id = pr.id;
$$;

revoke all on function save_push_subscription(text, text, text, text) from public, anon;
revoke all on function delete_push_subscription(text) from public, anon;
revoke all on function pms.due_stay_rings(timestamptz) from public, anon, authenticated;
revoke all on function stay_alarm_pushes(timestamptz) from public, anon, authenticated;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;
grant execute on function delete_push_subscription(text) to authenticated;
grant execute on function pms.due_stay_rings(timestamptz) to service_role;
grant execute on function stay_alarm_pushes(timestamptz) to service_role;
