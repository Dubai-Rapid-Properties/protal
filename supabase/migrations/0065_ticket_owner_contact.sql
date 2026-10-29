-- ============================================================================
-- D|R|P PMS - 0065 Reminders to contact the owner about a ticket
--
-- Every new repair or complaint has to be followed by a call to the unit's
-- owner. Until staff mark the ticket "Owner contacted", the operations inbox
-- gets a reminder every two hours, like an alarm that keeps ringing; marking
-- it contacted stops them. "Not yet" starts them again. A ticket that is
-- completed, closed, rejected or cancelled is no longer chased.
--
--   * maintenance_requests.owner_contact: 'pending' for every new ticket,
--     'contacted' once marked. Tickets raised before this migration stay
--     null and are not chased.
--   * claim_owner_contact_reminders() picks the tickets due a reminder and
--     stamps them in one statement, so two runs of the scheduler never send
--     the same reminder twice. The portal's two-minute scheduler
--     (/api/cron/stay-alarms) calls it and sends the emails.
-- ============================================================================

alter table maintenance_requests
  add column if not exists owner_contact text
    check (owner_contact in ('pending', 'contacted')),
  add column if not exists owner_contacted_at timestamptz,
  add column if not exists owner_contacted_by uuid references profiles(id) on delete set null,
  add column if not exists owner_reminded_at timestamptz,
  add column if not exists owner_reminders_sent integer not null default 0;

-- Only tickets raised from now on: the existing ones keep null.
alter table maintenance_requests alter column owner_contact set default 'pending';

comment on column maintenance_requests.owner_contact is
  'pending: the owner has not been contacted about this ticket yet, and operations is reminded every two hours. contacted: done, no more reminders. null: raised before reminders existed.';

create index if not exists maintenance_owner_contact_idx on maintenance_requests(owner_contact)
  where owner_contact = 'pending';

-- ---------------------------------------------------------------------------
-- The tickets due a reminder, stamped as reminded
-- ---------------------------------------------------------------------------
create or replace function claim_owner_contact_reminders(p_every interval default interval '2 hours')
returns table (
  id uuid,
  ticket_number text,
  title text,
  kind text,
  priority maintenance_priority,
  unit_id uuid,
  reported_at timestamptz,
  reminders_sent integer,
  previous_reminded_at timestamptz
)
language sql
security definer
set search_path = public, pms
as $$
  with due as (
    select r.id, r.owner_reminded_at as previous
      from maintenance_requests r
     where r.owner_contact = 'pending'
       and r.status not in ('completed', 'closed', 'rejected', 'cancelled')
       and coalesce(r.owner_reminded_at, r.created_at) <= now() - p_every
     for update skip locked
  )
  update maintenance_requests r
     set owner_reminded_at = now(),
         owner_reminders_sent = r.owner_reminders_sent + 1
    from due
   where r.id = due.id
  returning r.id, r.ticket_number, r.title, r.kind, r.priority, r.unit_id, r.reported_at,
            r.owner_reminders_sent, due.previous;
$$;

revoke all on function claim_owner_contact_reminders(interval) from public, anon, authenticated;
grant execute on function claim_owner_contact_reminders(interval) to service_role;
