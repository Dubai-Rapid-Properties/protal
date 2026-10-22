-- ============================================================================
-- D|R|P PMS - 0047 Move a stay to another unit; a cancelled stay that still pays
--
-- Two things staff could not record:
--
--   * A guest booked one unit and stays in another (Rita booked Cloud Tower
--     2704 on Airbnb and stays in 405). move_booking() moves the booking -
--     guest, price, Airbnb code - to the other unit. A stay synced from the
--     first unit's Airbnb calendar is linked there (channel_stay_links, 0036),
--     so that calendar's sync skips it instead of importing it again, and it
--     loses its feed UID, so the new unit's sync never cancels it as "missing
--     from the feed". Its calendar hold, turnover clean and income follow it:
--     the income goes to the new unit's owner.
--
--   * A guest cancels but the channel still pays (a strict cancellation
--     policy). bookings.payout_kept: the stay is cancelled - its dates are
--     free - and its payout still posts as income, on its check-out day like
--     any other stay (post_completed_bookings, 0023/0025).
-- ============================================================================

alter table bookings add column if not exists payout_kept boolean not null default false;

comment on column bookings.payout_kept is
  'Cancelled, but the channel still pays: payout_expected_aed posts as income on the check-out day.';

-- The calendar hold follows a booking moved to another unit.
drop trigger if exists bookings_sync_block on bookings;
create trigger bookings_sync_block
  after insert or update of status, check_in, check_out, unit_id on bookings
  for each row execute function pms.sync_booking_block();


-- ---------------------------------------------------------------------------
-- move_booking
-- ---------------------------------------------------------------------------
create or replace function move_booking(p_booking_id uuid, p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  b        bookings%rowtype;
  v_from   text;
  v_to     text;
  v_hold   record;
  v_back   text;
  v_note   text;
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found' using errcode = 'no_data_found';
  end if;
  if not (pms.can_write_unit(b.unit_id) and pms.can_write_unit(p_unit_id)) then
    raise exception 'You do not have access to both units' using errcode = 'insufficient_privilege';
  end if;
  if b.unit_id = p_unit_id then
    raise exception 'The stay is already on that unit' using errcode = 'check_violation';
  end if;
  if b.status not in ('inquiry','tentative','confirmed','checked_in') then
    raise exception 'Only an upcoming or current stay can be moved' using errcode = 'check_violation';
  end if;

  select p.name || ' ' || u.unit_number into v_from
    from units u join properties p on p.id = u.property_id where u.id = b.unit_id;
  select p.name || ' ' || u.unit_number into v_to
    from units u join properties p on p.id = u.property_id where u.id = p_unit_id;
  if v_to is null then
    raise exception 'Unit not found' using errcode = 'no_data_found';
  end if;

  -- Owner stays, maintenance and manual holds on the new unit. Its channel
  -- blocks are expected: staff block Airbnb there for the moved guest.
  select reason, start_date, end_date into v_hold
    from availability_blocks
   where unit_id = p_unit_id
     and reason not in ('booking','channel_sync')
     and daterange(start_date, end_date, '[)') && daterange(b.check_in, b.check_out, '[)')
   order by start_date
   limit 1;
  if found then
    raise exception 'The unit is blocked from % to % (%)', v_hold.start_date, v_hold.end_date,
      replace(v_hold.reason::text, '_', ' ') using errcode = 'check_violation';
  end if;

  -- Moving back to the unit whose calendar it came from: it is that
  -- calendar's stay again, followed by its sync.
  delete from channel_stay_links l
   where l.unit_id = p_unit_id and l.booking_id = b.id and l.channel = b.channel
  returning l.ical_uid into v_back;

  if b.ical_uid is not null then
    insert into channel_stay_links (unit_id, channel, ical_uid, code, start_date, end_date, booking_id)
    values (b.unit_id, b.channel, b.ical_uid, b.external_booking_id, b.check_in, b.check_out, b.id)
    on conflict (unit_id, channel, ical_uid) do update
      set booking_id = excluded.booking_id, code = excluded.code,
          start_date = excluded.start_date, end_date = excluded.end_date,
          linked_by = auth.uid(), linked_at = now();
  end if;

  v_note := format('Moved from %s to %s on %s.', v_from, v_to,
                   to_char((now() at time zone 'Asia/Dubai')::date, 'DD Mon YYYY'));
  if b.ical_uid is not null then
    v_note := v_note || format(
      ' The %s reservation%s stays on %s''s listing; that calendar''s sync no longer changes this booking.',
      case b.channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com'
                     else initcap(replace(b.channel::text, '_', ' ')) end,
      coalesce(' ' || b.external_booking_id, ''), v_from);
  end if;

  update bookings
     set unit_id = p_unit_id,
         ical_uid = v_back,
         internal_notes = nullif(concat_ws(E'\n', nullif(internal_notes, ''), v_note), '')
   where id = b.id;

  -- Its turnover clean, if not started, moves with it; every unfinished
  -- turnover on either unit points at the next arrival on its own unit.
  update housekeeping_tasks
     set unit_id = p_unit_id
   where booking_id = b.id and status in ('pending','assigned');

  update housekeeping_tasks t
     set next_booking_id = (
           select n.id from bookings n
            where n.unit_id = t.unit_id
              and n.check_in >= s.check_out
              and n.status in ('tentative','confirmed','checked_in')
              and n.id <> s.id
            order by n.check_in
            limit 1)
    from bookings s
   where s.id = t.booking_id
     and t.kind = 'turnover'
     and t.status in ('pending','assigned')
     and t.unit_id in (b.unit_id, p_unit_id);
end;
$$;

comment on function move_booking(uuid, uuid) is
  'Moves a stay to another unit: its hold, turnover clean and income follow; a synced stay is linked on its old calendar so that sync skips it.';

revoke all on function move_booking(uuid, uuid) from public, anon;
grant execute on function move_booking(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- post_completed_bookings: as 0025, plus cancelled stays whose payout is
-- kept, and a line that changes unit changes owner too.
-- ---------------------------------------------------------------------------
create or replace function post_completed_bookings()
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_cat   uuid := (select id from gl_categories where code = 'INC-BOOKING');
  v_posted integer;
begin
  -- Staff, or the service role (cron). Owners and tenants never post.
  if auth.uid() is not null and not pms.is_staff() then
    return 0;
  end if;

  -- Lines whose stay was deleted, not yet in a statement.
  delete from ledger_entries le
   where le.source_table = 'bookings'
     and le.statement_id is null
     and not exists (select 1 from bookings b where b.id = le.source_id);

  -- Lines whose stay no longer qualifies, not yet in a statement.
  delete from ledger_entries le
   using bookings b
   where le.source_table = 'bookings'
     and le.source_id = b.id
     and le.statement_id is null
     and (not (b.status in ('confirmed','checked_in','checked_out')
               or (b.status = 'cancelled' and b.payout_kept))
          or b.check_out > v_today
          or coalesce(b.payout_expected_aed, 0) <= 0);

  -- Lines whose stay's payout, dates or unit moved, not yet in a statement.
  update ledger_entries le
     set amount_aed = b.payout_expected_aed,
         entry_date = b.check_out,
         unit_id    = b.unit_id,
         owner_id   = case when le.unit_id is distinct from b.unit_id then
                        (select uo.owner_id from unit_ownerships uo
                          where uo.unit_id = b.unit_id and uo.end_date is null
                          order by uo.is_primary_contact desc, uo.ownership_pct desc
                          limit 1)
                      else le.owner_id end
    from bookings b
   where le.source_table = 'bookings'
     and le.source_id = b.id
     and le.statement_id is null
     and (le.amount_aed <> b.payout_expected_aed
          or le.entry_date <> b.check_out
          or le.unit_id is distinct from b.unit_id);

  -- New lines for ended, priced stays.
  insert into ledger_entries (
    entry_date, unit_id, owner_id, category_id, direction, description,
    amount_aed, vat_applicable, source_table, source_id, booking_id
  )
  select b.check_out,
         b.unit_id,
         (select uo.owner_id from unit_ownerships uo
           where uo.unit_id = b.unit_id and uo.end_date is null
           order by uo.is_primary_contact desc, uo.ownership_pct desc
           limit 1),
         v_cat,
         'income',
         case when b.status = 'cancelled' then 'Cancelled stay, payout kept ' else 'Stay ' end
           || b.booking_number
           || coalesce(' (' || case b.channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' else initcap(replace(b.channel::text, '_', ' ')) end || ' ' || b.external_booking_id || ')', '')
           || ', ' || to_char(b.check_in, 'DD Mon') || ' - ' || to_char(b.check_out, 'DD Mon YYYY'),
         b.payout_expected_aed,
         false,
         'bookings',
         b.id,
         b.id
    from bookings b
   where (b.status in ('confirmed','checked_in','checked_out')
          or (b.status = 'cancelled' and b.payout_kept))
     and b.check_out <= v_today
     and coalesce(b.payout_expected_aed, 0) > 0
     and not exists (select 1 from ledger_entries le
                      where le.source_table = 'bookings' and le.source_id = b.id);
  get diagnostics v_posted = row_count;

  return v_posted;
end;
$$;
