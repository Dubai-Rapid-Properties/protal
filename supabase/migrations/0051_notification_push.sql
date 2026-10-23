-- ============================================================================
-- D|R|P PMS - 0051 Every portal notification on the phone, app closed
--
-- Notifications (new, changed and cancelled bookings; tickets) showed only
-- inside the portal. Now each one is also pushed to the recipient's devices
-- as a phone notification - a banner like any app's - for staff and owners.
-- The check-out / check-in alarms (0043) stay with super admins and
-- housekeeping.
--
--   * save_push_subscription(): any signed-in account may turn notifications
--     on for its device, owners included (0043 allowed staff only).
--   * notifications.pushed_at: when it went to the phones. Rows from before
--     this migration count as sent, so turning it on sends no backlog.
--   * claim_notification_pushes(): marks the unsent notifications sent and
--     returns each with its recipient's devices, in one step, so two runs
--     never push the same one twice. Server only.
-- ============================================================================

alter table notifications add column if not exists pushed_at timestamptz;
update notifications set pushed_at = coalesce(pushed_at, created_at) where pushed_at is null;
create index if not exists notifications_unpushed_idx on notifications (created_at) where pushed_at is null;

create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and is_active) then
    raise exception 'Sign in to turn on notifications' using errcode = 'insufficient_privilege';
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

create or replace function claim_notification_pushes()
returns table (
  notification_id uuid,
  title text,
  body text,
  link text,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
language sql
volatile
security definer
set search_path = public, pms
as $$
  with claimed as (
    update notifications n
       set pushed_at = now()
     where n.pushed_at is null
       -- Older than a day is no longer news.
       and n.created_at > now() - interval '1 day'
    returning n.id, n.recipient_id, n.title, n.body, n.link
  )
  select c.id, c.title, c.body, c.link, s.id, s.endpoint, s.p256dh, s.auth
    from claimed c
    join profiles p on p.id = c.recipient_id and p.is_active
    join push_subscriptions s on s.profile_id = c.recipient_id;
$$;

revoke all on function claim_notification_pushes() from public, anon, authenticated;
grant execute on function claim_notification_pushes() to service_role;
