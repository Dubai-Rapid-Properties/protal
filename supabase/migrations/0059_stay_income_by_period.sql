-- ============================================================================
-- D|R|P PMS - 0059 Long stays: income by the nights in each statement period
--
-- Owner statements are generated on the 15th of each month, for the 16th of
-- the month before to the 15th. A stay's payout used to post in one line on
-- its check-out day, so a stay from 28 Sep to 1 Dec showed on no statement
-- until December. Now a stay is cut at every 16th it spans, and each part
-- posts as its own income line once its period has come:
--
--   28 Sep - 1 Dec (64 nights, AED 6,400)
--     28 Sep - 15 Oct  18 nights  dated 15 Oct  AED 1,800.00
--     16 Oct - 15 Nov  31 nights  dated 15 Nov  AED 3,100.00
--     16 Nov - 30 Nov  15 nights  dated  1 Dec  AED 1,500.00 (the rest)
--
--   * each part = round(payout x its nights / the stay's nights, 2); the last
--     part takes what is left, so the parts always add up to the payout.
--   * a part in an owner statement is frozen; a later change of payout
--     lands on the parts not yet in one.
--   * a stay that ends on the 16th is dated the 15th: its last night is in
--     the period that closes then.
--   * ledger_entries.stay_nights: the nights a line covers (0 for a cancelled
--     stay whose payout is kept, which posts whole on its check-out day).
--   * stays with a one-line posting already in a statement are left as they
--     are; one-line postings not in a statement are redone in parts.
--   * statements count the nights of each line, not the whole stay's.
-- ============================================================================

alter table ledger_entries add column if not exists stay_nights integer;

comment on column ledger_entries.stay_nights is
  'For a stay''s income line: the nights it covers (a stay is posted in parts, one per statement period; 0059).';

drop index if exists ledger_entries_booking_source_idx;
create unique index if not exists ledger_entries_booking_part_idx
  on ledger_entries (source_id, entry_date)
  where source_table = 'bookings';


-- ---------------------------------------------------------------------------
-- pms.stay_parts: a stay cut at every 16th it spans.
-- ---------------------------------------------------------------------------
create or replace function pms.stay_parts(p_check_in date, p_check_out date)
returns table (entry_date date, nights integer, is_last boolean)
language sql
immutable
as $$
  with cuts as (
    select d::date as d
      from generate_series(date_trunc('month', p_check_in)::date + 15, p_check_out - 1, interval '1 month') d
     where d::date > p_check_in
  ), parts as (
    select a, lead(a, 1, p_check_out) over (order by a) as b
      from (select p_check_in as a union all select d from cuts) x
  )
  select case when extract(day from b) = 16 then b - 1 else b end,
         b - a,
         b = p_check_out
    from parts
   order by a;
$$;


-- ---------------------------------------------------------------------------
-- post_completed_bookings: as 0047, with stays posted in parts.
-- ---------------------------------------------------------------------------
create or replace function post_completed_bookings()
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_today  date := (now() at time zone 'Asia/Dubai')::date;
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
       and b.check_in <= v_today
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
   where e.entry_date <= v_today;

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
                          where w.booking_id = le.source_id and w.entry_date = le.entry_date));

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


-- ---------------------------------------------------------------------------
-- generate_owner_statement: as 0058, counting each line's nights.
-- ---------------------------------------------------------------------------
create or replace function generate_owner_statement(
  p_owner_id        uuid,
  p_period_start    date,
  p_period_end      date,
  p_fee_pct         numeric default null,
  p_fee_vat         boolean default true,
  p_other_items     jsonb default '[]'::jsonb,
  p_other_charges   jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_statement_id uuid;
  v_income   numeric(14,2) := 0;
  v_expense  numeric(14,2) := 0;
  v_fee      numeric(14,2) := 0;
  v_fee_vat  numeric(14,2) := 0;
  v_other    numeric(14,2) := 0;
  v_items    jsonb := coalesce(p_other_items, '[]'::jsonb);
  v_item     jsonb;
  v_amount   numeric(14,2);
  v_charges  jsonb := coalesce(p_other_charges, '[]'::jsonb);
  v_hidden   numeric(14,2) := 0;
  v_vat_rate numeric(5,4);
  v_sort     integer := 0;
  v_pct      numeric;
  v_with_vat boolean;
  v_line_fee numeric(14,2);
  v_line_vat numeric(14,2);
  v_units    integer;
  v_booked   integer;
  r          record;
begin
  if not pms.is_staff() and auth.uid() is not null then
    raise exception 'Only staff can generate statements' using errcode = 'insufficient_privilege';
  end if;
  if p_fee_pct is not null and (p_fee_pct < 0 or p_fee_pct > 100) then
    raise exception 'The management fee must be between 0%% and 100%%' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_charges) <> 'array' then
    raise exception 'Other fees must be a list' using errcode = 'invalid_parameter_value';
  end if;
  for v_item in select * from jsonb_array_elements(v_charges) loop
    if length(trim(coalesce(v_item->>'description', ''))) not between 1 and 200
       or (v_item->>'amount') is null or (v_item->>'amount')::numeric <= 0 then
      raise exception 'Each other fee needs what it is for and an amount above 0'
        using errcode = 'check_violation';
    end if;
    v_hidden := v_hidden + round((v_item->>'amount')::numeric, 2);
  end loop;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Utility fees must be a list' using errcode = 'invalid_parameter_value';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    if length(trim(coalesce(v_item->>'description', ''))) not between 1 and 200
       or (v_item->>'amount') is null or (v_item->>'amount')::numeric <= 0 then
      raise exception 'Each utility fee needs what it is for and an amount above 0'
        using errcode = 'check_violation';
    end if;
  end loop;

  select coalesce(vat_rate, 0) into v_vat_rate from company_settings where id;
  v_vat_rate := coalesce(v_vat_rate, 0);

  if exists (
    select 1 from owner_statements
    where owner_id = p_owner_id
      and period_start = p_period_start
      and period_end = p_period_end
      and status <> 'void'
  ) then
    raise exception 'A statement already exists for this owner and period';
  end if;

  insert into owner_statements (owner_id, period_start, period_end, status, created_by,
                                management_fee_pct, fee_vat_applied, other_fees_aed, other_fees_note)
  values (p_owner_id, p_period_start, p_period_end, 'draft', auth.uid(),
          p_fee_pct, case when p_fee_pct is not null then p_fee_vat end, 0, null)
  returning id into v_statement_id;

  -- Snapshot every ledger entry on this owner's units for the period that has
  -- not already been carried on another statement. Income lines carry their
  -- stay and the management fee on them.
  for r in
    select le.*, gc.code as category_code, gc.affects_owner_statement,
           u.unit_number, p.name as property_name,
           b.check_in as b_check_in, b.check_out as b_check_out,
           coalesce(le.stay_nights, b.nights) as b_nights,
           coalesce(g.full_name,
                    (select bg.full_name from booking_guests bg
                      where bg.booking_id = b.id
                      order by bg.is_lead_guest desc, bg.created_at limit 1)) as b_guest,
           ma.commission_pct as ma_pct, ma.fee_vat_applicable as ma_vat
    from ledger_entries le
    join gl_categories gc on gc.id = le.category_id
    left join units u on u.id = le.unit_id
    left join properties p on p.id = u.property_id
    left join bookings b on b.id = le.booking_id
    left join guests g on g.id = b.guest_id
    left join lateral (
      select m.commission_pct, m.fee_vat_applicable
        from management_agreements m
       where m.unit_id = le.unit_id
         and m.owner_id = p_owner_id
         and m.is_active
         and m.start_date <= p_period_end
         and m.end_date >= p_period_start
       order by m.start_date desc
       limit 1
    ) ma on true
    where le.owner_id = p_owner_id
      and le.entry_date between p_period_start and p_period_end
      and le.statement_id is null
      and le.is_owner_visible
      and gc.affects_owner_statement
      and gc.code <> 'EXP-MGMT-FEE'      -- the fee is computed here, not copied
    order by le.entry_date, le.created_at
  loop
    v_sort := v_sort + 1;
    v_line_fee := null;
    v_line_vat := null;

    if r.direction = 'income' then
      v_income := v_income + r.amount_aed;
      v_pct      := coalesce(p_fee_pct, r.ma_pct);
      v_with_vat := case when p_fee_pct is not null then p_fee_vat else coalesce(r.ma_vat, false) end;
      if v_pct is not null then
        v_line_fee := round(r.amount_aed * v_pct / 100.0, 2);
        v_line_vat := case when v_with_vat then round(v_line_fee * v_vat_rate, 2) else 0 end;
        v_fee      := v_fee + v_line_fee;
        v_fee_vat  := v_fee_vat + v_line_vat;
      end if;
    else
      v_expense := v_expense + r.total_aed;
    end if;

    insert into owner_statement_lines (
      statement_id, ledger_entry_id, unit_id, unit_label, entry_date,
      category_code, description, direction, amount_aed, vat_amount_aed,
      total_aed, sort_order,
      booking_id, guest_name, check_in, check_out, nights, mgmt_fee_aed, mgmt_fee_vat_aed
    ) values (
      v_statement_id, r.id, r.unit_id,
      coalesce(r.property_name || ' - ' || r.unit_number, 'Portfolio'),
      r.entry_date, r.category_code, r.description, r.direction,
      r.amount_aed, r.vat_amount_aed, r.total_aed, v_sort,
      r.booking_id, r.b_guest, r.b_check_in, r.b_check_out, r.b_nights, v_line_fee, v_line_vat
    );

    update ledger_entries set statement_id = v_statement_id where id = r.id;
  end loop;

  -- Fixed-fee agreements (no percentage, none set by finance): one line per unit.
  if p_fee_pct is null then
    for r in
      select ma.unit_id, ma.fixed_fee_aed, ma.fee_vat_applicable,
             u.unit_number, p.name as property_name
      from management_agreements ma
      join units u on u.id = ma.unit_id
      join properties p on p.id = u.property_id
      where ma.owner_id = p_owner_id
        and ma.is_active
        and ma.start_date <= p_period_end
        and ma.end_date >= p_period_start
        and ma.commission_pct is null
        and coalesce(ma.fixed_fee_aed, 0) > 0
    loop
      -- Management fee is a taxable supply of services: VAT normally applies.
      v_line_fee := r.fixed_fee_aed;
      v_line_vat := case when r.fee_vat_applicable then round(v_line_fee * v_vat_rate, 2) else 0 end;
      v_fee      := v_fee + v_line_fee;
      v_fee_vat  := v_fee_vat + v_line_vat;
      v_sort     := v_sort + 1;

      insert into owner_statement_lines (
        statement_id, unit_id, unit_label, entry_date, category_code,
        description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
      ) values (
        v_statement_id, r.unit_id, r.property_name || ' - ' || r.unit_number,
        p_period_end, 'EXP-MGMT-FEE', 'Management fee (fixed)',
        'expense', v_line_fee, v_line_vat, v_line_fee + v_line_vat, v_sort
      );
    end loop;
  end if;

  -- Utility fees, one line each, as entered, with the expenses.
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_amount := round((v_item->>'amount')::numeric, 2);
    v_other  := v_other + v_amount;
    v_sort   := v_sort + 1;
    insert into owner_statement_lines (
      statement_id, unit_label, entry_date, category_code,
      description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
    ) values (
      v_statement_id, 'Portfolio', p_period_end, 'EXP-OTHER-FEES',
      trim(v_item->>'description'), 'expense', v_amount, 0, v_amount, v_sort
    );
  end loop;

  -- Occupancy: nights booked inside the period on the owner's holiday-home
  -- units, over the nights those units had in it. The ownership's start date
  -- is not checked: it defaults to the day the owner was linked (0003).
  select count(*) into v_units
    from units u
   where u.operating_mode in ('short_term', 'both')
     and exists (select 1 from unit_ownerships uo
                  where uo.unit_id = u.id and uo.owner_id = p_owner_id
                    and (uo.end_date is null or uo.end_date >= p_period_start));
  select coalesce(sum(greatest(0, least(b.check_out, p_period_end + 1)
                                  - greatest(b.check_in, p_period_start))), 0)
    into v_booked
    from bookings b
    join units u on u.id = b.unit_id
   where u.operating_mode in ('short_term', 'both')
     and b.status in ('confirmed', 'checked_in', 'checked_out')
     and b.check_in <= p_period_end
     and b.check_out > p_period_start
     and exists (select 1 from unit_ownerships uo
                  where uo.unit_id = u.id and uo.owner_id = p_owner_id
                    and (uo.end_date is null or uo.end_date >= p_period_start));

  -- Other fees: kept for staff (other_charges), never on the owner's
  -- statement and not taken off the payout.
  update owner_statements
     set other_charges_aed  = v_hidden,
         other_charges      = (select coalesce(jsonb_agg(jsonb_build_object(
                                 'description', trim(x->>'description'),
                                 'amount', round((x->>'amount')::numeric, 2))), '[]'::jsonb)
                                 from jsonb_array_elements(v_charges) x),
         gross_income_aed   = v_income,
         total_expenses_aed = v_expense,
         management_fee_aed = v_fee,
         vat_total_aed      = v_fee_vat,
         other_fees_aed     = v_other,
         bookings_count     = (select count(distinct booking_id) from owner_statement_lines
                                where statement_id = v_statement_id and direction = 'income'
                                  and booking_id is not null),
         rented_nights      = (select coalesce(sum(nights), 0) from owner_statement_lines
                                where statement_id = v_statement_id and direction = 'income'
                                  and booking_id is not null),
         occupancy_pct      = case when v_units > 0 then
                                least(100, round(v_booked * 100.0 / (v_units * (p_period_end - p_period_start + 1)), 1))
                              end,
         net_payout_aed     = v_income - v_expense - v_other - v_fee - v_fee_vat,
         closing_balance_aed = v_income - v_expense - v_other - v_fee - v_fee_vat
   where id = v_statement_id;

  return v_statement_id;
end;
$$;

revoke all on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb) from public, anon;
grant execute on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb) to authenticated;


-- Redo the postings in parts now, rather than at the next calendar sync.
select post_completed_bookings();
