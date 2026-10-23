-- ============================================================================
-- D|R|P PMS - 0053 Photos on repairs and complaints
--
-- A ticket now carries photos: staff add them in the back office, owners in
-- their portal, when reporting an issue or later on its page. The files are
-- in the private documents bucket under ticket/<ticket id>/; the server
-- shows them through short-lived links to whoever may read the ticket.
--
--   * maintenance_requests.photo_paths: the ticket's photos, oldest first.
--   * add_ticket_photo(): adds one to a ticket the caller may read (staff on
--     their units, owners on their own), up to 12. Removing one is for super
--     admins, as with every other file in the vault.
--   * guard_owner_ticket_update() (0019) lets an owner's ticket change only
--     their approval decision; it now also lets through a photo that
--     add_ticket_photo() is adding, and nothing else.
-- ============================================================================

-- Nullable on purpose: a row restored from the audit log (from before this
-- migration) carries no value; the app reads null as no photos.
alter table maintenance_requests add column if not exists photo_paths text[] default '{}';

create or replace function add_ticket_photo(p_ticket_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_unit   uuid;
  v_photos text[];
begin
  select unit_id, coalesce(photo_paths, '{}') into v_unit, v_photos
    from maintenance_requests where id = p_ticket_id for update;
  if v_unit is null or not pms.can_read_unit(v_unit) then
    raise exception 'Ticket not found' using errcode = 'insufficient_privilege';
  end if;
  if p_path !~ ('^ticket/' || p_ticket_id::text || '/[^/]+$') then
    raise exception 'Not a photo of this ticket' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_photos) >= 12 then
    raise exception 'A ticket holds up to 12 photos' using errcode = 'check_violation';
  end if;
  -- Tells the owner guard below this is the photo being added.
  perform set_config('pms.adding_ticket_photo', p_ticket_id::text, true);
  update maintenance_requests set photo_paths = v_photos || p_path where id = p_ticket_id;
  perform set_config('pms.adding_ticket_photo', '', true);
end;
$$;

revoke all on function add_ticket_photo(uuid, text) from public, anon;
grant execute on function add_ticket_photo(uuid, text) to authenticated;

-- As 0019, plus the photo add_ticket_photo() is adding.
create or replace function pms.guard_owner_ticket_update()
returns trigger
language plpgsql
set search_path = public, pms
as $$
declare
  c_decision constant text[] := array[
    'status', 'owner_approved_at', 'owner_approved_by', 'approved_amount_aed',
    'owner_rejected_at', 'owner_rejection_reason', 'updated_at'];
begin
  if pms.is_staff() or auth.uid() is null then
    return new;
  end if;

  if current_setting('pms.adding_ticket_photo', true) = new.id::text
     and (to_jsonb(new) - 'photo_paths' - 'updated_at') = (to_jsonb(old) - 'photo_paths' - 'updated_at') then
    return new;
  end if;

  if (to_jsonb(new) - c_decision) is distinct from (to_jsonb(old) - c_decision)
     or new.status not in ('approved', 'rejected')
     or (new.owner_approved_by is not null and new.owner_approved_by <> auth.uid()) then
    raise exception 'Owners can only approve or decline a quote'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
