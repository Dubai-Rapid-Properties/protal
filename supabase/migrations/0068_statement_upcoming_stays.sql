-- ============================================================================
-- D|R|P PMS - 0068 Statements include the period's stays still to come
--
-- Stay income was posted to the ledger only once each part of the stay had
-- passed (up to today), so a statement made on the 9th for the period to the
-- 15th left out a stay of the 12th-14th. post_completed_bookings now takes
-- p_until: the statement pages pass the period's end, and the stays in the
-- period are posted up to then. A part posted ahead is kept by the regular
-- runs while its stay is still on with those dates, and goes, like any
-- unstatemented line, if the stay is cancelled or moves.
-- ============================================================================

drop function if exists post_completed_bookings();

create or replace function post_completed_bookings(p_until date default null)
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_today  date := (now() at time zone 'Asia/Dubai')::date;
  -- Stays are posted up to today, or up to p_until when a statement for a
  -- period ending later is being made (its stays to come in that period).
  v_until  date := greatest((now() at time zone 'Asia/Dubai')::date, coalesce(p_until, (now() at time zone 'Asia/Dubai')::date));
  v_cat    uuid := (select id from gl_categories where code = 'INC-BOOKING');
  v_posted integer;
begin
  -- Staff, or the service role (cron). Owners and tenants never post.
  if auth.uid() is not null and not pms.is_staff() then
    return 0;
  end if;

  create temp table if not exists pms_stay_income (
    booking_id  uuid,
    entry_date  date,
    nights      integer,
    amount_aed  numeric(14,2),
    unit_id     uuid,
    description text
  ) on commit drop;
  truncate pms_stay_income;

  -- Every part that is due, with its amount.
  insert into pms_stay_income
  with q as (
    select b.*
      from bookings b
     where (b.status in ('confirmed','checked_in','checked_out')
            or (b.status = 'cancelled' and b.payout_kept))
       and coalesce(b.payout_expected_aed, 0) > 0
       and b.check_in <= v_until
       -- A one-line posting (before 0059), or a part whose dates no longer
       -- fit the stay, already in a statement: leave the stay as it is.
       and not exists (
         select 1 from ledger_entries le
          where le.source_table = 'bookings' and le.source_id = b.id
            and le.statement_id is not null
            and (le.stay_nights is null
                 or (b.status <> 'cancelled'
                     and le.entry_date not in (select s.entry_date from pms.stay_parts(b.check_in, b.check_out) s))))
  ), p as (
    select q.id, q.unit_id, q.payout_expected_aed as payout, q.nights as total,
           s.entry_date, s.nights, s.is_last,
           count(*) over (partition by q.id) as parts,
           case when q.status = 'cancelled' then 'Cancelled stay, payout kept ' else 'Stay ' end
             || q.booking_number
             || coalesce(' (' || case q.channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' else initcap(replace(q.channel::text, '_', ' ')) end || ' ' || q.external_booking_id || ')', '')
             || ', ' || to_char(q.check_in, 'DD Mon') || ' - ' || to_char(q.check_out, 'DD Mon YYYY') as label
      from q
      cross join lateral (
        select x.entry_date, x.nights, x.is_last
          from pms.stay_parts(q.check_in, q.check_out) x
         where q.status <> 'cancelled'
        union all
        select case when extract(day from q.check_out) = 16 then q.check_out - 1 else q.check_out end, q.nights, true
         where q.status = 'cancelled'
      ) s
  ), d as (
    select p.*, f.amount_aed as frozen,
           case when not p.is_last
                then coalesce(f.amount_aed, round(p.payout * p.nights / p.total, 2)) end as share
      from p
      left join ledger_entries f
        on f.source_table = 'bookings' and f.source_id = p.id
       and f.entry_date = p.entry_date and f.statement_id is not null
  ), e as (
    select d.*,
           case when d.is_last
                then coalesce(d.frozen, d.payout - coalesce(sum(d.share) over (partition by d.id), 0))
                else d.share end as amount
      from d
  )
  select e.id, e.entry_date,
         case when e.label like 'Cancelled%' then 0 else e.nights end,
         e.amount, e.unit_id,
         e.label || case when e.parts > 1 then ' (' || e.nights || ' of ' || e.total || ' nights)' else '' end
    from e
   where e.entry_date <= v_until;

  -- Lines whose stay was deleted, not yet in a statement.
  delete from ledger_entries le
   where le.source_table = 'bookings'
     and le.statement_id is null
     and not exists (select 1 from bookings b where b.id = le.source_id);

  -- Lines no longer due (cancelled, unpriced, dates moved, one-line
  -- postings now in parts), not yet in a statement.
  delete from ledger_entries le
   where le.source_table = 'bookings'
     and le.statement_id is null
     and (le.stay_nights is null
          or not exists (select 1 from pms_stay_income w
                          where w.booking_id = le.source_id and w.entry_date = le.entry_date))
     -- A part still to come, posted for a statement (p_until), stays while its
     -- stay is still on, with those dates; the run that reaches it updates it.
     and not (le.entry_date > v_until
              and exists (select 1 from bookings b
                           where b.id = le.source_id
                             and b.status in ('confirmed', 'checked_in', 'checked_out')
                             and coalesce(b.payout_expected_aed, 0) > 0
                             and le.entry_date in (select s.entry_date from pms.stay_parts(b.check_in, b.check_out) s)));

  -- Lines whose amount, nights or unit moved, not yet in a statement.
  update ledger_entries le
     set amount_aed  = w.amount_aed,
         stay_nights = w.nights,
         description = w.description,
         unit_id     = w.unit_id,
         owner_id    = case when le.unit_id is distinct from w.unit_id then
                         (select uo.owner_id from unit_ownerships uo
                           where uo.unit_id = w.unit_id and uo.end_date is null
                           order by uo.is_primary_contact desc, uo.ownership_pct desc
                           limit 1)
                       else le.owner_id end
    from pms_stay_income w
   where le.source_table = 'bookings'
     and le.source_id = w.booking_id
     and le.entry_date = w.entry_date
     and le.statement_id is null
     and (le.amount_aed <> w.amount_aed
          or le.stay_nights is distinct from w.nights
          or le.description is distinct from w.description
          or le.unit_id is distinct from w.unit_id);

  -- New lines for the parts that are due.
  insert into ledger_entries (
    entry_date, unit_id, owner_id, category_id, direction, description,
    amount_aed, vat_applicable, source_table, source_id, booking_id, stay_nights
  )
  select w.entry_date,
         w.unit_id,
         (select uo.owner_id from unit_ownerships uo
           where uo.unit_id = w.unit_id and uo.end_date is null
           order by uo.is_primary_contact desc, uo.ownership_pct desc
           limit 1),
         v_cat,
         'income',
         w.description,
         w.amount_aed,
         false,
         'bookings',
         w.booking_id,
         w.booking_id,
         w.nights
    from pms_stay_income w
   where not exists (select 1 from ledger_entries le
                      where le.source_table = 'bookings'
                        and le.source_id = w.booking_id
                        and le.entry_date = w.entry_date);
  get diagnostics v_posted = row_count;

  return v_posted;
end;
$$;

grant execute on function post_completed_bookings(date) to authenticated, service_role;
