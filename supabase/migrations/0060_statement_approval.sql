-- ============================================================================
-- D|R|P PMS - 0060 Owner statements: approved before they reach the owner
--
-- The office (operations) generates a statement and sends it for approval;
-- the approver (Jasko) checks it and, on approving, sends it to the owner.
--
--   draft            generated; the office can still void or delete it
--   draft, submitted waiting for the approver (submitted_at set)
--   issued           approved and emailed to the owner (approved_*, sent_*)
--   paid             the payout went out
--
--   * company_settings.statement_approver_id: who approves. Set to Jasko's
--     login when one exists; without one, any super admin approves.
--   * A statement leaves draft for issued only through the approver
--     (pms.can_approve_statements), checked here as well as in the app.
--   * Sending for approval notifies the approver - in the portal and on the
--     phone (0051); approving notifies whoever sent it.
-- ============================================================================

alter table owner_statements
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references profiles(id) on delete set null,
  add column if not exists sent_at      timestamptz,
  add column if not exists sent_to      text,
  add column if not exists return_note  text check (return_note is null or length(return_note) <= 500);

comment on column owner_statements.submitted_at is
  'When the office sent this draft for approval; cleared if the approver sends it back.';
comment on column owner_statements.sent_to is
  'The owner''s email address the approved statement went to.';

alter table company_settings
  add column if not exists statement_approver_id uuid references profiles(id) on delete set null;

comment on column company_settings.statement_approver_id is
  'Approves owner statements before they go to the owner; any super admin when not set.';

update company_settings
   set statement_approver_id = (
     select p.id from profiles p
      where p.is_active and p.role = 'super_admin'
        and (p.full_name ilike 'jasko%' or p.email ilike 'jasko%')
      order by p.created_at
      limit 1)
 where id and statement_approver_id is null;


create or replace function pms.can_approve_statements()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.is_active
       and p.id = coalesce((select statement_approver_id from company_settings where id),
                           case when p.role = 'super_admin' then p.id end)
  );
$$;

create or replace function can_approve_statements()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$ select pms.can_approve_statements(); $$;

revoke all on function can_approve_statements() from public, anon;
grant execute on function can_approve_statements() to authenticated;


-- Only the approver takes a statement out of draft to the owner.
create or replace function pms.guard_statement_issue()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if old.status = 'draft' and new.status in ('issued', 'approved', 'paid')
     and auth.uid() is not null and not pms.can_approve_statements() then
    raise exception 'Only the statement approver can send a statement to the owner'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists owner_statements_guard_issue on owner_statements;
create trigger owner_statements_guard_issue
  before update of status on owner_statements
  for each row execute function pms.guard_statement_issue();


-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('booking_new', 'booking_changed', 'booking_cancelled',
                  'ticket_new', 'ticket_status', 'refund_new', 'refund_settled',
                  'statement_review', 'statement_done'));

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
    insert into notifications (recipient_id, kind, title, body, link)
    select p.id, 'statement_review', 'Statement to approve', v_what, v_link
      from profiles p
     where p.is_active
       and p.id is distinct from v_actor
       and p.id = coalesce((select statement_approver_id from company_settings where id),
                           case when p.role = 'super_admin' then p.id end);
  end if;

  -- Approved and sent, or sent back: whoever sent it for approval.
  if new.submitted_by is not null and new.submitted_by is distinct from v_actor then
    if new.status = 'issued' and old.status = 'draft' then
      insert into notifications (recipient_id, kind, title, body, link)
      values (new.submitted_by, 'statement_done', 'Statement approved and sent', v_what, v_link);
    elsif new.submitted_at is null and old.submitted_at is not null and new.status = 'draft' then
      insert into notifications (recipient_id, kind, title, body, link)
      values (new.submitted_by, 'statement_done', 'Statement sent back',
              v_what || coalesce(': ' || nullif(trim(new.return_note), ''), ''), v_link);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists owner_statements_notify on owner_statements;
create trigger owner_statements_notify
  after update of status, submitted_at on owner_statements
  for each row execute function pms.notify_statement_event();
