-- ============================================================================
-- D|R|P PMS - 0035 Staff can remove a "Blocked on Airbnb" period
--
-- An Airbnb "Not available" period comes from the listing's calendar feed, so
-- deleting it in the portal did nothing: the next sync (every 15 minutes)
-- put it back. Staff could not clear a block that no longer means anything to
-- them - an old private stay, a period Airbnb merged with others.
--
-- dismiss_channel_block() now removes such a block and remembers it by the
-- feed's UID and dates. The sync's insert of that same block is then skipped.
-- If the channel changes the block's dates it is a different period and comes
-- back (and the dismissal is forgotten); a block the feed drops simply goes,
-- as before. The dates stay closed on Airbnb itself - only the portal stops
-- showing them as blocked.
-- ============================================================================

create table if not exists channel_block_dismissals (
  unit_id      uuid not null references units(id) on delete cascade,
  ical_uid     text not null,
  start_date   date not null,
  end_date     date not null,
  dismissed_by uuid references profiles(id) on delete set null default auth.uid(),
  dismissed_at timestamptz not null default now(),
  primary key (unit_id, ical_uid)
);

comment on table channel_block_dismissals is
  'Channel "not available" periods staff removed from the portal; the calendar sync does not bring them back while their dates are unchanged.';

alter table channel_block_dismissals enable row level security;

create policy channel_block_dismissals_read on channel_block_dismissals
  for select to authenticated using (pms.is_staff() and pms.can_write_unit(unit_id));
create policy channel_block_dismissals_write on channel_block_dismissals
  for all to authenticated
  using (pms.is_staff() and pms.can_write_unit(unit_id))
  with check (pms.is_staff() and pms.can_write_unit(unit_id));

revoke all on channel_block_dismissals from public, anon;
grant select, insert, update, delete on channel_block_dismissals to authenticated;
grant all on channel_block_dismissals to service_role;

-- Removes one synced channel block and keeps it from coming back. Runs as the
-- caller, so the block and dismissal policies decide who may.
create or replace function dismiss_channel_block(p_block_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pms
as $$
declare
  b availability_blocks%rowtype;
begin
  select * into b
    from availability_blocks
   where id = p_block_id and reason = 'channel_sync' and ical_uid is not null;
  if not found then
    raise exception 'Airbnb block not found' using errcode = 'no_data_found';
  end if;

  insert into channel_block_dismissals (unit_id, ical_uid, start_date, end_date)
  values (b.unit_id, b.ical_uid, b.start_date, b.end_date)
  on conflict (unit_id, ical_uid) do update
    set start_date = excluded.start_date, end_date = excluded.end_date,
        dismissed_by = auth.uid(), dismissed_at = now();

  delete from availability_blocks where id = p_block_id;
end;
$$;

revoke all on function dismiss_channel_block(uuid) from public, anon;
grant execute on function dismiss_channel_block(uuid) to authenticated;

-- The sync's insert of a dismissed block, with the same dates, is skipped.
-- Sees every dismissal whoever runs the sync (staff's Sync now, or the cron).
create or replace function pms.skip_dismissed_channel_block()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  d channel_block_dismissals%rowtype;
begin
  select * into d from channel_block_dismissals
   where unit_id = new.unit_id and ical_uid = new.ical_uid;
  if not found then
    return new;
  end if;
  if d.start_date = new.start_date and d.end_date = new.end_date then
    return null;
  end if;
  -- The channel changed the period: show it again.
  delete from channel_block_dismissals where unit_id = new.unit_id and ical_uid = new.ical_uid;
  return new;
end;
$$;

drop trigger if exists availability_blocks_skip_dismissed on availability_blocks;
create trigger availability_blocks_skip_dismissed
  before insert on availability_blocks
  for each row
  when (new.reason = 'channel_sync' and new.ical_uid is not null)
  execute function pms.skip_dismissed_channel_block();
