-- ============================================================================
-- D|R|P PMS - 0052 Refunds: office costs staff paid out of their own pocket
--
-- Someone buys something for the office with their own money and claims it
-- back. Every staff member sees the list and can add a claim: who paid, what
-- for, how much, the receipt photo. Super admins mark it refunded (or
-- rejected). A new claim notifies the super admins and finance - in the
-- portal and on their phones (0051) - and a settled one notifies whoever
-- added it.
-- ============================================================================

create table if not exists refunds (
  id           uuid primary key default gen_random_uuid(),
  spent_by     text not null check (length(trim(spent_by)) between 2 and 60),
  description  text not null check (length(trim(description)) between 2 and 500),
  amount_aed   numeric(12,2) not null check (amount_aed > 0 and amount_aed < 1000000),
  spent_on     date not null default ((now() at time zone 'Asia/Dubai')::date),
  -- In the private documents bucket: refund/<id>/<file>; staff only (0011).
  receipt_path text,
  status       text not null default 'pending' check (status in ('pending', 'refunded', 'rejected')),
  settled_on   date,
  settled_by   uuid references profiles(id) on delete set null,
  settle_note  text check (settle_note is null or length(settle_note) <= 300),
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists refunds_status_idx on refunds (status, created_at desc);

comment on table refunds is
  'Office costs a staff member paid personally and claims back. Staff only.';

alter table refunds enable row level security;

drop policy if exists refunds_staff_read on refunds;
create policy refunds_staff_read on refunds
  for select to authenticated
  using (pms.is_staff());

drop policy if exists refunds_staff_add on refunds;
create policy refunds_staff_add on refunds
  for insert to authenticated
  with check (pms.is_staff() and created_by = auth.uid() and status = 'pending');

-- Super admins settle any claim; whoever added a claim may correct it (its
-- receipt, amount, wording) while it is still pending.
drop policy if exists refunds_update on refunds;
create policy refunds_update on refunds
  for update to authenticated
  using (pms.is_admin() or (created_by = auth.uid() and status = 'pending'))
  with check (pms.is_admin() or (created_by = auth.uid() and status = 'pending'));

drop policy if exists refunds_admin_delete on refunds;
create policy refunds_admin_delete on refunds
  for delete to authenticated
  using (pms.is_admin());


-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('booking_new', 'booking_changed', 'booking_cancelled',
                  'ticket_new', 'ticket_status', 'refund_new', 'refund_settled'));

create or replace function pms.notify_refund_event()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_actor  uuid := auth.uid();
  v_amount text := 'AED ' || to_char(new.amount_aed, 'FM999,999,990.00');
begin
  if tg_op = 'INSERT' then
    insert into notifications (recipient_id, kind, title, body, link)
    select p.id, 'refund_new',
           'Refund claim: ' || v_amount,
           new.spent_by || ' paid for ' || new.description,
           '/refunds'
      from profiles p
     where p.is_active
       and p.role in ('super_admin', 'finance')
       and p.id is distinct from v_actor;
  elsif new.status <> old.status and new.status in ('refunded', 'rejected')
        and new.created_by is not null and new.created_by is distinct from v_actor then
    insert into notifications (recipient_id, kind, title, body, link)
    values (new.created_by, 'refund_settled',
            case new.status when 'refunded' then 'Refunded: ' else 'Refund declined: ' end || v_amount,
            new.spent_by || ' - ' || new.description
              || coalesce(' (' || nullif(trim(new.settle_note), '') || ')', ''),
            '/refunds');
  end if;
  return new;
end;
$$;

drop trigger if exists refunds_notify on refunds;
create trigger refunds_notify
  after insert or update of status on refunds
  for each row execute function pms.notify_refund_event();
