-- ============================================================================
-- D|R|P PMS - 0075 Statements: rent and dates set by hand; one unit at a time
--
-- The statement takes each booking's rent and dates from the ledger. Finance
-- can now set them by hand for a booking: a booking adjustment may carry
-- "rent" (AED, replaces the ledger's amount on the statement) and
-- "check_in"/"check_out" (the dates and nights the owner sees). The ledger
-- itself is not changed. What was entered is kept on the line (adjustment),
-- so Edit opens on it.
--
-- A statement can also be for one of the owner's units only (unit_id), so
-- an owner with several units gets one statement per unit. Without a unit
-- it covers all of them, as before. One live statement per owner, period
-- and unit (or all units).
-- ============================================================================

alter table owner_statement_lines add column if not exists adjustment jsonb;

alter table owner_statements add column if not exists unit_id uuid references units(id) on delete set null;
drop index if exists owner_statements_live_period_idx;
create unique index if not exists owner_statements_live_period_idx
  on owner_statements (owner_id, period_start, period_end, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'void';

drop function if exists generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb);

create or replace function generate_owner_statement(
  p_owner_id        uuid,
  p_period_start    date,
  p_period_end      date,
  p_fee_pct         numeric default null,
  p_fee_vat         boolean default true,
  p_other_items     jsonb default '[]'::jsonb,
  p_other_charges   jsonb default '[]'::jsonb,
  p_booking_adjustments jsonb default '[]'::jsonb,
  p_unit_id         uuid default null
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
  v_adjust   jsonb := coalesce(p_booking_adjustments, '[]'::jsonb);
  v_rent     numeric(14,2);
  v_cut      numeric(14,2);
  v_cut_items jsonb;
  v_adj      jsonb;
  v_base     numeric(14,2);
  v_in       date;
  v_out      date;
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
       or ((v_item->>'amount') is null) = ((v_item->>'pct') is null)
       or coalesce((v_item->>'amount')::numeric, 1) <= 0
       or coalesce((v_item->>'pct')::numeric, 1) not between 0.01 and 100 then
      raise exception 'Each other fee needs what it is for and an amount above 0, or a %% up to 100'
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Booking deductions: one per income line at most, an amount or a %.
  if jsonb_typeof(v_adjust) <> 'array' then
    raise exception 'Booking deductions must be a list' using errcode = 'invalid_parameter_value';
  end if;
  for v_item in select * from jsonb_array_elements(v_adjust) loop
    if jsonb_typeof(coalesce(v_item->'items', '[]'::jsonb)) <> 'array'
       or exists (select 1 from jsonb_array_elements(coalesce(v_item->'items', '[]'::jsonb)) i
                   where length(trim(coalesce(i->>'description', ''))) not between 1 and 200
                      or coalesce((i->>'amount')::numeric, 0) <= 0) then
      raise exception 'Each booking fee needs what it is for and an amount above 0'
        using errcode = 'check_violation';
    end if;
    -- The rent and dates set by hand (0075): a rent of 0 or more; both dates, in order.
    if coalesce((v_item->>'rent')::numeric, 0) < 0
       or ((v_item->>'check_in') is null) <> ((v_item->>'check_out') is null)
       or (v_item->>'check_in')::date >= (v_item->>'check_out')::date then
      raise exception 'A booking set by hand needs a rent of 0 or more, and a check-out after its check-in'
        using errcode = 'check_violation';
    end if;
    -- An amount or a %, the booking's fees (0073), or its rent or dates set by hand (0075).
    if (v_item->>'ledger_entry_id') is null
       or ((v_item->>'amount') is not null and (v_item->>'pct') is not null)
       or ((v_item->>'amount') is null and (v_item->>'pct') is null
           and jsonb_array_length(coalesce(v_item->'items', '[]'::jsonb)) = 0
           and (v_item->>'rent') is null and (v_item->>'check_in') is null)
       or coalesce((v_item->>'pct')::numeric, 0) not between -1000 and 100 then
      -- A negative amount or % adds to the rent: a stay whose payout came in
      -- short (an Airbnb feed with one night's rate) is put right this way.
      raise exception 'Each booking adjustment needs an amount, or a %% up to 100 off'
        using errcode = 'check_violation';
    end if;
  end loop;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Utility fees must be a list' using errcode = 'invalid_parameter_value';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    if length(trim(coalesce(v_item->>'description', ''))) not between 1 and 200
       or (v_item->>'amount') is null or (v_item->>'amount')::numeric <= 0 then
      raise exception 'Each utility or maintenance fee needs what it is for and an amount above 0'
        using errcode = 'check_violation';
    end if;
  end loop;

  select coalesce(vat_rate, 0) into v_vat_rate from company_settings where id;
  v_vat_rate := coalesce(v_vat_rate, 0);

  -- One unit of the owner's only (0075): it must be theirs.
  if p_unit_id is not null and not exists (
    select 1 from unit_ownerships uo where uo.unit_id = p_unit_id and uo.owner_id = p_owner_id
  ) then
    raise exception 'That unit is not this owner''s' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from owner_statements
    where owner_id = p_owner_id
      and period_start = p_period_start
      and period_end = p_period_end
      and unit_id is not distinct from p_unit_id
      and status <> 'void'
  ) then
    raise exception 'A statement already exists for this owner and period';
  end if;

  insert into owner_statements (owner_id, unit_id, period_start, period_end, status, created_by,
                                management_fee_pct, fee_vat_applied, other_fees_aed, other_fees_note)
  values (p_owner_id, p_unit_id, p_period_start, p_period_end, 'draft', auth.uid(),
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
      and (p_unit_id is null or le.unit_id = p_unit_id)
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

    v_rent := r.amount_aed;
    v_cut  := null;
    v_cut_items := null;
    v_adj  := null;
    v_in   := null;
    v_out  := null;
    if r.direction = 'income' then
      -- A deduction finance entered for this booking: the owner's statement
      -- shows the rent after it.
      -- With the booking's own fees (0073): cleaning, guest fee, DTCM...,
      -- all taken off at once.
      select a into v_adj
        from jsonb_array_elements(v_adjust) a
       where (a->>'ledger_entry_id')::uuid = r.id
       limit 1;
      if v_adj is not null then
        -- The rent set by hand replaces the ledger's (0075); the adjustment
        -- and the fees then come off it. All of it is kept as one deduction
        -- from the ledger's amount.
        v_in   := (v_adj->>'check_in')::date;
        v_out  := (v_adj->>'check_out')::date;
        v_base := coalesce(round((v_adj->>'rent')::numeric, 2), r.amount_aed);
        v_cut  := (r.amount_aed - v_base)
                  + coalesce(round((v_adj->>'amount')::numeric, 2), round(v_base * (v_adj->>'pct')::numeric / 100.0, 2), 0)
                  + coalesce((select sum(round((i->>'amount')::numeric, 2))
                                from jsonb_array_elements(coalesce(v_adj->'items', '[]'::jsonb)) i), 0);
        v_cut_items := nullif(coalesce(v_adj->'items', '[]'::jsonb), '[]'::jsonb);
        v_adj  := v_adj - 'ledger_entry_id';
      end if;
      if v_cut > r.amount_aed then
        raise exception 'A booking deduction of AED % is more than its rent of AED %', v_cut, r.amount_aed
          using errcode = 'check_violation';
      end if;
      v_rent   := r.amount_aed - coalesce(v_cut, 0);
      v_income := v_income + v_rent;
      v_pct      := coalesce(p_fee_pct, r.ma_pct);
      v_with_vat := case when p_fee_pct is not null then p_fee_vat else coalesce(r.ma_vat, false) end;
      if v_pct is not null then
        v_line_fee := round(v_rent * v_pct / 100.0, 2);
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
      booking_id, guest_name, check_in, check_out, nights, mgmt_fee_aed, mgmt_fee_vat_aed,
      original_amount_aed, deduction_aed, deduction_items, adjustment
    ) values (
      v_statement_id, r.id, r.unit_id,
      coalesce(r.property_name || ' - ' || r.unit_number, 'Portfolio'),
      r.entry_date, r.category_code, r.description, r.direction,
      v_rent, r.vat_amount_aed, case when r.direction = 'income' then v_rent else r.total_aed end, v_sort,
      r.booking_id, r.b_guest,
      coalesce(v_in, r.b_check_in), coalesce(v_out, r.b_check_out),
      case when v_in is not null then v_out - v_in else r.b_nights end,
      v_line_fee, v_line_vat,
      case when v_cut is not null then r.amount_aed end, v_cut, v_cut_items, v_adj
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
        and (p_unit_id is null or ma.unit_id = p_unit_id)
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
      v_statement_id,
      coalesce((select p.name || ' - ' || u.unit_number from units u join properties p on p.id = u.property_id
                 where u.id = p_unit_id), 'Portfolio'),
      p_period_end,
      -- "kind": "maintenance" items go on the Maintenance row, the rest on Utilities.
      case when v_item->>'kind' = 'maintenance' then 'EXP-MAINT' else 'EXP-OTHER-FEES' end,
      trim(v_item->>'description'), 'expense', v_amount, 0, v_amount, v_sort
    );
  end loop;

  -- Occupancy: nights booked inside the period on the owner's holiday-home
  -- units, over the nights those units had in it. The ownership's start date
  -- is not checked: it defaults to the day the owner was linked (0003).
  select count(*) into v_units
    from units u
   where u.operating_mode in ('short_term', 'both')
     and (p_unit_id is null or u.id = p_unit_id)
     and exists (select 1 from unit_ownerships uo
                  where uo.unit_id = u.id and uo.owner_id = p_owner_id
                    and (uo.end_date is null or uo.end_date >= p_period_start));
  select coalesce(sum(greatest(0, least(b.check_out, p_period_end + 1)
                                  - greatest(b.check_in, p_period_start))), 0)
    into v_booked
    from bookings b
    join units u on u.id = b.unit_id
   where u.operating_mode in ('short_term', 'both')
     and (p_unit_id is null or u.id = p_unit_id)
     and b.status in ('confirmed', 'checked_in', 'checked_out')
     and b.check_in <= p_period_end
     and b.check_out > p_period_start
     and exists (select 1 from unit_ownerships uo
                  where uo.unit_id = u.id and uo.owner_id = p_owner_id
                    and (uo.end_date is null or uo.end_date >= p_period_start));

  -- Other fees: kept for staff (other_charges), never on the owner's
  -- statement and not taken off the payout.
  -- Other fees: as entered, or a % of the statement's booking income.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'description', trim(x->>'description'),
           'pct', (x->>'pct')::numeric,
           'amount', coalesce(round((x->>'amount')::numeric, 2),
                              round(v_income * (x->>'pct')::numeric / 100.0, 2))))), '[]'::jsonb)
    into v_charges
    from jsonb_array_elements(v_charges) x;
  select coalesce(sum((x->>'amount')::numeric), 0) into v_hidden from jsonb_array_elements(v_charges) x;

  update owner_statements
     set other_charges_aed  = v_hidden,
         other_charges      = v_charges,
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

revoke all on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb, uuid) to authenticated;

-- Editing keeps the statement's unit.
create or replace function revise_owner_statement(
  p_statement_id    uuid,
  p_period_start    date,
  p_period_end      date,
  p_fee_pct         numeric default null,
  p_fee_vat         boolean default true,
  p_other_items     jsonb default '[]'::jsonb,
  p_other_charges   jsonb default '[]'::jsonb,
  p_booking_adjustments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_old owner_statements%rowtype;
  v_new uuid;
begin
  if not pms.is_staff() and auth.uid() is not null then
    raise exception 'Only staff can edit statements' using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from owner_statements where id = p_statement_id for update;
  if not found then
    raise exception 'Statement not found' using errcode = 'no_data_found';
  end if;
  if v_old.status <> 'draft' or v_old.submitted_at is not null then
    raise exception 'Only a draft that is not waiting for approval can be edited'
      using errcode = 'check_violation';
  end if;

  -- Free its ledger lines and remove it; the new one takes them again.
  update ledger_entries set statement_id = null where statement_id = p_statement_id;
  delete from owner_statements where id = p_statement_id;
  -- Freed, its stays' lines follow their bookings again: a price put right
  -- since the draft was made reaches the ledger before it is rebuilt (0074).
  perform post_completed_bookings(p_period_end);

  perform set_config('pms.keep_statement_number', v_old.statement_number, true);
  v_new := generate_owner_statement(
    v_old.owner_id, p_period_start, p_period_end, p_fee_pct, p_fee_vat,
    p_other_items, p_other_charges, p_booking_adjustments, v_old.unit_id
  );
  perform set_config('pms.keep_statement_number', '', true);

  -- Still the same draft: who made it, when, and the approver's last note.
  update owner_statements
     set created_by  = v_old.created_by,
         created_at  = v_old.created_at,
         return_note = v_old.return_note
   where id = v_new;

  return v_new;
end;
$$;

revoke all on function revise_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function revise_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) to authenticated;


notify pgrst, 'reload schema';
