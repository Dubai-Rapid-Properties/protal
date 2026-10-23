-- ============================================================================
-- D|R|P PMS - 0061 Booking deductions, other fees as a %, the statement's name
--
--   * When generating, finance can take a deduction off any booking in the
--     period - an amount, or a % of its rent. The owner's statement shows the
--     rent after it (and the management fee is worked out on that); what was
--     taken off stays with staff (owner_statement_lines.original_amount_aed,
--     deduction_aed). The ledger keeps the full payout.
--   * An other fee (0056, for our own figures) can be a % of the statement's
--     booking income instead of an amount; the list keeps both.
--   * company_settings.statement_legal_name: the company named on owner
--     statements - DRP Holiday Homes LLC - where the rest of the portal uses
--     legal_name.
-- ============================================================================

alter table owner_statement_lines
  add column if not exists original_amount_aed numeric(14,2),
  add column if not exists deduction_aed       numeric(14,2);

comment on column owner_statement_lines.deduction_aed is
  'Taken off this booking''s rent when the statement was generated (staff only); amount_aed is the rent after it.';

alter table company_settings
  add column if not exists statement_legal_name text not null default 'DRP Holiday Homes LLC'
    check (length(trim(statement_legal_name)) between 2 and 200);

comment on column company_settings.statement_legal_name is
  'The company named on owner statements and the emails that send them.';

drop function if exists generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb);

create or replace function generate_owner_statement(
  p_owner_id        uuid,
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
    if (v_item->>'ledger_entry_id') is null
       or ((v_item->>'amount') is null) = ((v_item->>'pct') is null)
       or coalesce((v_item->>'amount')::numeric, 0) < 0
       or coalesce((v_item->>'pct')::numeric, 0) not between 0 and 100 then
      raise exception 'Each booking deduction needs an amount, or a %% up to 100'
        using errcode = 'check_violation';
    end if;
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

    v_rent := r.amount_aed;
    v_cut  := null;
    if r.direction = 'income' then
      -- A deduction finance entered for this booking: the owner's statement
      -- shows the rent after it.
      select coalesce(round((a->>'amount')::numeric, 2), round(r.amount_aed * (a->>'pct')::numeric / 100.0, 2))
        into v_cut
        from jsonb_array_elements(v_adjust) a
       where (a->>'ledger_entry_id')::uuid = r.id
       limit 1;
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
      original_amount_aed, deduction_aed
    ) values (
      v_statement_id, r.id, r.unit_id,
      coalesce(r.property_name || ' - ' || r.unit_number, 'Portfolio'),
      r.entry_date, r.category_code, r.description, r.direction,
      v_rent, r.vat_amount_aed, case when r.direction = 'income' then v_rent else r.total_aed end, v_sort,
      r.booking_id, r.b_guest, r.b_check_in, r.b_check_out, r.b_nights, v_line_fee, v_line_vat,
      case when v_cut is not null then r.amount_aed end, v_cut
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

revoke all on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
