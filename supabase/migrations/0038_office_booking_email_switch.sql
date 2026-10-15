-- ============================================================================
-- D|R|P PMS - 0038 Office booking emails: a switch, off
--
-- Every new, moved or cancelled stay emailed the company address
-- (company_settings.email, office@dubairapidproperties.com) as well as
-- notifying staff in the portal. D|R|P asked for these emails to stop.
--
-- company_settings.email_office_about_bookings (default off) gates them the
-- way 0022 gates owner emails: while it is off the email is not queued. The
-- portal notifications are unchanged, and the address itself stays - it is
-- the company's contact email on statements and documents.
-- Office booking emails already queued and not yet sent are marked failed
-- with the reason, so none goes out after this.
-- ============================================================================

alter table company_settings
  add column if not exists email_office_about_bookings boolean not null default false;

comment on column company_settings.email_office_about_bookings is
  'When false, booking emails to the office address are not sent (staff portal notifications still are).';

create or replace function pms.gate_office_booking_email()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if not coalesce((select email_office_about_bookings from company_settings where id), false) then
    return null; -- not queued
  end if;
  return new;
end;
$$;

drop trigger if exists messages_office_booking_email_gate on messages;
create trigger messages_office_booking_email_gate
  before insert on messages
  for each row
  when (new.channel = 'email' and new.party_kind = 'staff' and new.booking_id is not null)
  execute function pms.gate_office_booking_email();

update messages
   set status = 'failed', error_message = 'Office booking emails switched off (0038).'
 where channel = 'email' and party_kind = 'staff' and booking_id is not null and status = 'queued';
