-- ============================================================================
-- D|R|P PMS - 0046 Calendar sync: correct stays typed in with the wrong dates
--
-- An owner saw an Airbnb stay as 6-14 Dec when Airbnb has 7-14 Dec, and another
-- as 30 Nov - 1 Dec instead of 29-30 Nov. The stays had been typed in (or
-- imported) without their Airbnb confirmation code, and the sync only adopts
-- such a booking when the code or both dates match exactly. Anything else was
-- refused as a clash with that very booking, so the wrong dates stayed.
--
-- Now a booking on the same channel and unit, not yet synced, that overlaps
-- the feed's stay - the only one - is adopted and moved to the feed's dates.
-- It cannot be another guest: two bookings on a unit never overlap.
--
-- Also: a synced reservation missing from the feed is cancelled even when a
-- blocked period in the feed happens to carry its UID; only reservations
-- keep a reservation alive.
--
-- Same function as 0041_keep_past_channel_blocks.sql with those changes.
-- ============================================================================

create or replace function apply_channel_ical(
  p_unit_id uuid,
  p_channel sales_channel,
  p_events  jsonb,
  p_error   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pms
as $$
declare
  v_name     text := case p_channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' end;
  c_removed  text := 'Removed from the ' || case p_channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' end || ' calendar feed';
  v_first    boolean;
  v_clash    text;
  v_clash_id uuid;
  v_today    date := (now() at time zone 'Asia/Dubai')::date;
  v_now      timestamptz := now();
  v_events   jsonb := coalesce(p_events, '[]'::jsonb);
  e          jsonb;
  v_uid      text;
  v_start    date;
  v_end      date;
  v_code     text;
  v_kind     text;
  v_id       uuid;
  v_row      bookings%rowtype;
  v_uids     text[];
  v_res_uids text[];
  v_overlaps integer;
  v_live     integer;
  v_errors   text[] := '{}';
  v_created  integer := 0;
  v_updated  integer := 0;
  v_reinstated integer := 0;
  v_cancelled  integer := 0;
  v_blocks   integer := 0;
begin
  if p_channel not in ('airbnb','booking_com') then
    raise exception 'No calendar feed for channel %', p_channel using errcode = 'invalid_parameter_value';
  end if;

  select case p_channel when 'airbnb' then ical_last_synced_at is null
                        else booking_ical_last_synced_at is null end
    into v_first
    from units where id = p_unit_id;
  if not found then
    raise exception 'Unit % not found', p_unit_id using errcode = 'no_data_found';
  end if;

  if p_error is not null then
    if p_channel = 'airbnb' then
      update units
         set ical_last_synced_at = v_now, ical_last_status = 'error', ical_last_error = left(p_error, 500)
       where id = p_unit_id;
    else
      update units
         set booking_ical_last_synced_at = v_now, booking_ical_last_status = 'error',
             booking_ical_last_error = left(p_error, 500)
       where id = p_unit_id;
    end if;
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(p_error));
  end if;

  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'p_events must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(x->>'uid') filter (where x->>'uid' is not null), '{}')
    into v_uids
    from jsonb_array_elements(v_events) x;
  -- Reservations only: a blocked period is not a stay, so its UID must not
  -- keep a cancelled reservation alive (0046).
  select coalesce(array_agg(x->>'uid') filter (where x->>'uid' is not null
                                                 and coalesce(x->>'kind', 'reservation') <> 'blocked'), '{}')
    into v_res_uids
    from jsonb_array_elements(v_events) x;

  -- Clashes are what this read finds; last read's are forgotten (0036).
  delete from channel_feed_clashes where unit_id = p_unit_id and channel = p_channel;

  for e in select * from jsonb_array_elements(v_events) loop
    v_uid  := nullif(e->>'uid', '');
    v_code := nullif(e->>'code', '');
    v_kind := coalesce(e->>'kind', 'reservation');
    begin
      v_start := (e->>'start')::date;
      v_end   := (e->>'end')::date;
    exception when others then
      v_start := null;
    end;

    if v_uid is null or v_start is null or v_end is null or v_end <= v_start then
      v_errors := v_errors || format('Skipped an event with missing or invalid dates (%s).', coalesce(v_uid, 'no UID'));
      continue;
    end if;

    -- A stay staff linked to a booking already in the portal (a private guest
    -- who booked through the channel) is that booking: nothing to import.
    if v_kind <> 'blocked' and exists (
      select 1 from channel_stay_links l
       where l.unit_id = p_unit_id and l.channel = p_channel and l.ical_uid = v_uid
    ) then
      continue;
    end if;

    begin
      if v_kind = 'blocked' then
        insert into availability_blocks (unit_id, start_date, end_date, reason, source_channel, ical_uid, note)
        values (p_unit_id, v_start, v_end, 'channel_sync', p_channel, v_uid, 'Not available on ' || v_name)
        on conflict (unit_id, ical_uid) where ical_uid is not null
        do update set start_date = excluded.start_date, end_date = excluded.end_date;
        v_blocks := v_blocks + 1;
        continue;
      end if;

      select * into v_row from bookings where unit_id = p_unit_id and ical_uid = v_uid;

      if not found then
        -- The same stay under another UID: one typed in by hand or imported
        -- from the channel's export before the sync (no UID yet), or one an
        -- earlier read of this feed brought in under a UID the feed no longer
        -- uses - Booking.com issues new UIDs on each export. Adopt it rather
        -- than create a duplicate that would clash with it. A booking another
        -- event in this same feed still owns is never taken.
        select * into v_row
          from bookings
         where unit_id = p_unit_id
           and channel = p_channel
           and (ical_uid is null or not (ical_uid = any (v_uids)))
           and status in ('tentative','confirmed','checked_in')
           and ((v_code is not null and external_booking_id = v_code)
                or (check_in = v_start and check_out = v_end))
         order by coalesce(v_code is not null and external_booking_id = v_code, false) desc,
                  (ical_uid is null) desc
         limit 1;

        -- Typed in with the wrong dates and no confirmation code (0046): the
        -- one booking on this channel and unit, not yet synced, that overlaps
        -- the stay is that stay - two bookings on a unit cannot overlap, so it
        -- cannot be another guest. Without this, the stay was refused as a
        -- clash and the owner kept seeing the dates typed in.
        if not found then
          select count(*) into v_overlaps
            from bookings
           where unit_id = p_unit_id
             and channel = p_channel
             and (ical_uid is null or not (ical_uid = any (v_uids)))
             and status in ('tentative','confirmed','checked_in')
             and daterange(check_in, check_out, '[)') && daterange(v_start, v_end, '[)');
          if v_overlaps = 1 then
            select * into v_row
              from bookings
             where unit_id = p_unit_id
               and channel = p_channel
               and (ical_uid is null or not (ical_uid = any (v_uids)))
               and status in ('tentative','confirmed','checked_in')
               and daterange(check_in, check_out, '[)') && daterange(v_start, v_end, '[)');
          end if;
        end if;

        -- (A SELECT INTO with no row leaves v_row null; FOUND would also
        -- reflect the count above.)
        if v_row.id is not null then
          update bookings
             set ical_uid = v_uid,
                 external_booking_id = coalesce(external_booking_id, v_code),
                 check_in = v_start,
                 check_out = v_end,
                 last_seen_in_feed_at = v_now
           where id = v_row.id;
          v_updated := v_updated + 1;
        else
          -- The first read of a newly linked feed brings every existing
          -- reservation: recorded, not announced (0018 did this for Airbnb by
          -- its own sync time; each channel now has its own).
          insert into bookings (unit_id, channel, status, check_in, check_out, adults,
                                guest_count_known, ical_uid, external_booking_id,
                                last_seen_in_feed_at, internal_notes, import_source)
          values (p_unit_id, p_channel, 'confirmed', v_start, v_end, 1,
                  false, v_uid, v_code, v_now, 'Imported from the ' || v_name || ' calendar feed.',
                  case when v_first then 'feed_first_read' end);
          v_created := v_created + 1;
        end if;
      else
        if v_row.status = 'cancelled' and v_row.cancellation_reason = c_removed then
          -- It came back (Airbnb restored or re-listed it).
          update bookings
             set status = 'confirmed', cancelled_on = null, cancellation_reason = null,
                 check_in = v_start, check_out = v_end, last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
          v_reinstated := v_reinstated + 1;
        elsif v_row.check_in <> v_start or v_row.check_out <> v_end then
          update bookings
             set check_in = v_start, check_out = v_end, last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
          v_updated := v_updated + 1;
        else
          update bookings
             set last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
        end if;
      end if;
    exception
      when exclusion_violation then
        -- Name the booking in the way, so staff can see which one to check.
        select b.id, b.booking_number || ' (' ||
               case b.channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com'
                              when 'direct' then 'direct' else initcap(replace(b.channel::text, '_', ' ')) end ||
               coalesce(' ' || b.external_booking_id, '') || ', ' ||
               to_char(b.check_in, 'DD Mon') || ' - ' || to_char(b.check_out, 'DD Mon YYYY') || ')'
          into v_clash_id, v_clash
          from bookings b
         where b.unit_id = p_unit_id
           and b.status in ('tentative','confirmed','checked_in')
           and daterange(b.check_in, b.check_out, '[)') && daterange(v_start, v_end, '[)')
         order by b.check_in
         limit 1;
        v_errors := v_errors || format(
          '%s stay %s to %s overlaps %s on this unit and was not imported.', v_name,
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'),
          coalesce(v_clash, 'another booking'));
        insert into channel_feed_clashes (unit_id, channel, ical_uid, code, start_date, end_date, booking_id)
        values (p_unit_id, p_channel, v_uid, v_code, v_start, v_end, v_clash_id)
        on conflict (unit_id, channel, ical_uid) do update
          set code = excluded.code, start_date = excluded.start_date, end_date = excluded.end_date,
              booking_id = excluded.booking_id, seen_at = now();
      when check_violation or unique_violation then
        v_errors := v_errors || format('%s stay %s to %s: %s', v_name,
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'), sqlerrm);
    end;
  end loop;

  -- Cancellations: a synced future stay missing from the feed was cancelled
  -- on Airbnb. Past stays are left alone - Airbnb drops old events from the
  -- feed, which is not a cancellation. Checked-in guests are left alone too.
  select count(*) into v_live
    from bookings
   where unit_id = p_unit_id and channel = p_channel and ical_uid is not null
     and status in ('tentative','confirmed') and check_out > v_today;

  if jsonb_array_length(v_events) = 0 and v_live >= 2 then
    -- An empty feed with several live stays is far more likely a broken or
    -- replaced link than every guest cancelling at once.
    v_errors := v_errors || format(
      'The %s feed came back empty while %s upcoming stays are synced. Nothing was cancelled - check the calendar link.',
      v_name, v_live);
  else
    with gone as (
      update bookings
         set status = 'cancelled', cancelled_on = v_today, cancellation_reason = c_removed
       where unit_id = p_unit_id
         and channel = p_channel
         and ical_uid is not null
         and not (ical_uid = any (v_res_uids))
         and status in ('tentative','confirmed')
         and check_out > v_today
      returning 1
    )
    select count(*) into v_cancelled from gone;

    -- Only blocks that have not ended: Airbnb drops a period from its feed
    -- once it is over, and a finished block is the record of a stay
    -- (usually a direct guest D|R|P blocked Airbnb for).
    delete from availability_blocks
     where unit_id = p_unit_id
       and reason = 'channel_sync'
       and source_channel = p_channel
       and ical_uid is not null
       and not (ical_uid = any (v_uids))
       and end_date > v_today;
  end if;

  if p_channel = 'airbnb' then
    update units
       set ical_last_synced_at   = v_now,
           ical_last_status      = case when cardinality(v_errors) = 0 then 'ok' else 'error' end,
           ical_last_error       = nullif(array_to_string(v_errors[1:5], ' '), ''),
           ical_last_event_count = jsonb_array_length(v_events)
     where id = p_unit_id;
  else
    update units
       set booking_ical_last_synced_at   = v_now,
           booking_ical_last_status      = case when cardinality(v_errors) = 0 then 'ok' else 'error' end,
           booking_ical_last_error       = nullif(array_to_string(v_errors[1:5], ' '), ''),
           booking_ical_last_event_count = jsonb_array_length(v_events)
     where id = p_unit_id;
  end if;

  return jsonb_build_object(
    'ok',         cardinality(v_errors) = 0,
    'created',    v_created,
    'updated',    v_updated,
    'reinstated', v_reinstated,
    'cancelled',  v_cancelled,
    'blocks',     v_blocks,
    'errors',     to_jsonb(v_errors)
  );
end;
$$;
