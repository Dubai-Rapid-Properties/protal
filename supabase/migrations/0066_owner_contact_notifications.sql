-- ============================================================================
-- D|R|P PMS - 0066 Owner-contact reminders as notifications, not emails
--
-- The two-hourly "contact the owner" reminder (0065) emailed the operations
-- inbox. It is now a portal notification (on the bell and pushed to phones,
-- 0051) for the staff who get the ticket's own notifications: super admins,
-- the assignee, and staff assigned to the unit or its property. It still
-- stops once the ticket is marked "Owner contacted".
-- ============================================================================

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('booking_new', 'booking_changed', 'booking_cancelled',
                  'ticket_new', 'ticket_status', 'ticket_owner_contact',
                  'refund_new', 'refund_settled',
                  'statement_review', 'statement_done'));

create or replace function notify_owner_contact(p_ticket uuid, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_count integer;
begin
  insert into notifications (recipient_id, kind, title, body, link, unit_id, ticket_id)
  select p.id, 'ticket_owner_contact', p_title, p_body, '/maintenance/' || r.id, r.unit_id, r.id
    from maintenance_requests r
    join units u on u.id = r.unit_id
    join profiles p on p.is_active
     and (p.role = 'super_admin'
          or p.id = r.assigned_to
          or (p.role in ('property_manager', 'agent', 'maintenance')
              and (exists (select 1 from staff_unit_assignments a
                            where a.profile_id = p.id and a.unit_id = r.unit_id)
                   or exists (select 1 from staff_property_assignments a
                               where a.profile_id = p.id and a.property_id = u.property_id))))
   where r.id = p_ticket;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function notify_owner_contact(uuid, text, text) from public, anon, authenticated;
grant execute on function notify_owner_contact(uuid, text, text) to service_role;
