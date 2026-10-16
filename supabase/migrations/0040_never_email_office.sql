-- ============================================================================
-- D|R|P PMS - 0040 Never email office@dubairapidproperties.com
--
-- 0038 stopped the booking emails to the company address. D|R|P wants no
-- email at all to reach office@dubairapidproperties.com, whatever sends it:
-- an owner or staff record carrying that address, the company email switched
-- back on, anything added later.
--
--   * pms.never_emailed(): the addresses that never receive email.
--   * An email queued for one of them is not stored (like 0022 and 0038).
--   * Emails already queued for them are marked failed, so none goes out.
-- The app refuses to send to the same list (src/lib/messaging), so a direct
-- send - a portal invite - is stopped as well.
-- ============================================================================

create or replace function pms.never_emailed(p_address text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_address, ''))) = any (array['office@dubairapidproperties.com'])
$$;

create or replace function pms.gate_never_emailed()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if pms.never_emailed(new.to_address) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_never_emailed_gate on messages;
create trigger messages_never_emailed_gate
  before insert on messages
  for each row
  when (new.channel = 'email')
  execute function pms.gate_never_emailed();

update messages
   set status = 'failed',
       error_message = 'Emails to this address are switched off (0040).'
 where channel = 'email'
   and status = 'queued'
   and pms.never_emailed(to_address);
