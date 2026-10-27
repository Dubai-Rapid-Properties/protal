-- ============================================================================
-- D|R|P PMS - 0063 Notifications go when what they are about goes
--
-- Booking and ticket notifications already carry their booking_id / ticket_id
-- and disappear with them (on delete cascade). Refund claims and owner
-- statements did not: deleting a claim or a statement removed it, but the
-- "Refund claim" / "Statement to approve" notifications it had sent stayed in
-- everyone else's list. They now carry refund_id / statement_id the same way,
-- and the ones left behind by claims and statements already deleted are
-- removed here.
-- ============================================================================

alter table notifications
  add column if not exists refund_id uuid references refunds(id) on delete cascade,
  add column if not exists statement_id uuid references owner_statements(id) on delete cascade;

create index if not exists notifications_refund_idx on notifications(refund_id) where refund_id is not null;
create index if not exists notifications_statement_idx on notifications(statement_id) where statement_id is not null;

-- ---------------------------------------------------------------------------
-- The triggers record what each notification is about (otherwise as 0052, 0060)
-- ---------------------------------------------------------------------------
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
    insert into notifications (recipient_id, kind, title, body, link, refund_id)
    select p.id, 'refund_new',
           'Refund claim: ' || v_amount,
           new.spent_by || ' paid for ' || new.description,
           '/refunds', new.id
      from profiles p
     where p.is_active
       and p.role in ('super_admin', 'finance')
       and p.id is distinct from v_actor;
  elsif new.status <> old.status and new.status in ('refunded', 'rejected')
        and new.created_by is not null and new.created_by is distinct from v_actor then
    insert into notifications (recipient_id, kind, title, body, link, refund_id)
    values (new.created_by, 'refund_settled',
            case new.status when 'refunded' then 'Refunded: ' else 'Refund declined: ' end || v_amount,
            new.spent_by || ' - ' || new.description
              || coalesce(' (' || nullif(trim(new.settle_note), '') || ')', ''),
            '/refunds', new.id);
  end if;
  return new;
end;
$$;


create or replace function pms.notify_statement_event()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_actor uuid := auth.uid();
  v_what  text;
  v_link  text := '/finance/statements/' || new.id;
begin
  select new.statement_number || ' - ' || o.full_name || ', '
         || to_char(new.period_start, 'DD Mon') || ' - ' || to_char(new.period_end, 'DD Mon YYYY')
    into v_what
    from owners o where o.id = new.owner_id;

  -- Sent for approval: the approver, or every super admin when none is set.
  if new.submitted_at is not null and old.submitted_at is null then
    insert into notifications (recipient_id, kind, title, body, link, statement_id)
    select p.id, 'statement_review', 'Statement to approve', v_what, v_link, new.id
      from profiles p
     where p.is_active
       and p.id is distinct from v_actor
       and p.id = coalesce((select statement_approver_id from company_settings where id),
                           case when p.role = 'super_admin' then p.id end);
  end if;

  -- Approved and sent, or sent back: whoever sent it for approval.
  if new.submitted_by is not null and new.submitted_by is distinct from v_actor then
    if new.status = 'issued' and old.status = 'draft' then
      insert into notifications (recipient_id, kind, title, body, link, statement_id)
      values (new.submitted_by, 'statement_done', 'Statement approved and sent', v_what, v_link, new.id);
    elsif new.submitted_at is null and old.submitted_at is not null and new.status = 'draft' then
      insert into notifications (recipient_id, kind, title, body, link, statement_id)
      values (new.submitted_by, 'statement_done', 'Statement sent back',
              v_what || coalesce(': ' || nullif(trim(new.return_note), ''), ''), v_link, new.id);
    end if;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Existing notifications: link them to their claim or statement, and remove
-- the ones whose claim or statement is gone.
-- ---------------------------------------------------------------------------

-- Statements: the link ends in the statement's id.
update notifications n
   set statement_id = s.id
  from owner_statements s
 where n.kind in ('statement_review', 'statement_done')
   and n.statement_id is null
   and n.link = '/finance/statements/' || s.id;

delete from notifications
 where kind in ('statement_review', 'statement_done')
   and statement_id is null;

-- Refunds: the text names who paid and what for (0052).
update notifications n
   set refund_id = r.id
  from refunds r
 where n.kind = 'refund_new'
   and n.refund_id is null
   and n.body = r.spent_by || ' paid for ' || r.description;

update notifications n
   set refund_id = r.id
  from refunds r
 where n.kind = 'refund_settled'
   and n.refund_id is null
   and n.recipient_id = r.created_by
   and (n.body = r.spent_by || ' - ' || r.description
        or n.body like r.spent_by || ' - ' || r.description || ' (%');

delete from notifications
 where kind in ('refund_new', 'refund_settled')
   and refund_id is null;
