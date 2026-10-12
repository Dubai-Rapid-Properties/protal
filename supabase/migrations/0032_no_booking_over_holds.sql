-- ============================================================================
-- D|R|P PMS - 0032 No booking over an owner stay, and no hold over a booking
--
-- bookings_no_overlap (0005) stops two stays sharing a night, but nothing in
-- the database stopped a stay landing on an owner stay, a maintenance hold or
-- a manual block. The staff forms check this themselves; the Airbnb and
-- Booking.com feeds, the CSV import and confirming a request did not, so an
-- owner could find a guest booked into their own stay.
--
-- Now both sides are refused in SQL, whatever writes them:
--   * a live booking (tentative, confirmed, checked in) whose nights touch an
--     owner stay, maintenance, housekeeping or manual block;
--   * an owner stay, maintenance, housekeeping or manual block whose nights
--     touch a live booking.
-- Blocks mirrored from bookings ('booking') and dates closed on Airbnb
-- ('channel_sync') are not holds: D|R|P closes Airbnb for its own direct
-- guests, so a direct booking is expected there.
--
-- The refusal is a check_violation with a sentence naming the clash, so the
-- feed sync reports it against that stay ("Airbnb stay ... : These dates
-- overlap an owner stay ...") and the rest of the feed still imports.
--
-- Only new or moved stays and holds are checked: a stay that already overlaps
-- from before this migration can still be checked in, out or cancelled.
-- ============================================================================

create or replace function pms.hold_label(p_reason block_reason)
returns text
language sql
immutable
as $$
  select case p_reason
    when 'owner_stay'   then 'an owner stay'
    when 'maintenance'  then 'a maintenance block'
    when 'housekeeping' then 'a housekeeping block'
    else 'a blocked period'
  end
$$;

-- One writer at a time per unit calendar, so a booking and a hold saved at
-- the same moment cannot each miss the other.
create or replace function pms.lock_unit_calendar(p_unit_id uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('unit-calendar:' || p_unit_id::text))
$$;

create or replace function pms.reject_booking_over_hold()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_hold availability_blocks%rowtype;
begin
  if new.status not in ('tentative','confirmed','checked_in') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('tentative','confirmed','checked_in')
     and new.unit_id = old.unit_id
     and new.check_in = old.check_in
     and new.check_out = old.check_out then
    return new;
  end if;

  perform pms.lock_unit_calendar(new.unit_id);

  select * into v_hold
    from availability_blocks ab
   where ab.unit_id = new.unit_id
     and ab.reason not in ('booking','channel_sync')
     and daterange(ab.start_date, ab.end_date, '[)') && daterange(new.check_in, new.check_out, '[)')
   order by ab.start_date
   limit 1;

  if found then
    raise exception 'These dates overlap % on this unit (% to %). Move or remove it first.',
      pms.hold_label(v_hold.reason),
      to_char(v_hold.start_date, 'DD Mon YYYY'), to_char(v_hold.end_date, 'DD Mon YYYY')
      using errcode = 'check_violation', constraint = 'bookings_no_overlap_holds';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_hold_gate on bookings;
create trigger bookings_hold_gate
  before insert or update of status, unit_id, check_in, check_out on bookings
  for each row execute function pms.reject_booking_over_hold();

create or replace function pms.reject_hold_over_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_booking bookings%rowtype;
begin
  if new.reason in ('booking','channel_sync') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.reason not in ('booking','channel_sync')
     and new.unit_id = old.unit_id
     and new.start_date = old.start_date
     and new.end_date = old.end_date then
    return new;
  end if;

  perform pms.lock_unit_calendar(new.unit_id);

  select * into v_booking
    from bookings b
   where b.unit_id = new.unit_id
     and b.status in ('tentative','confirmed','checked_in')
     and daterange(b.check_in, b.check_out, '[)') && daterange(new.start_date, new.end_date, '[)')
   order by b.check_in
   limit 1;

  if found then
    raise exception 'Booking % (% to %) is in these dates. Cancel or move it first.',
      v_booking.booking_number,
      to_char(v_booking.check_in, 'DD Mon YYYY'), to_char(v_booking.check_out, 'DD Mon YYYY')
      using errcode = 'check_violation', constraint = 'availability_blocks_no_overlap_bookings';
  end if;

  return new;
end;
$$;

drop trigger if exists availability_blocks_booking_gate on availability_blocks;
create trigger availability_blocks_booking_gate
  before insert or update of reason, unit_id, start_date, end_date on availability_blocks
  for each row execute function pms.reject_hold_over_booking();
