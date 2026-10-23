-- ============================================================================
-- D|R|P PMS - 0056 Other fees: deducted, not itemised for the owner
--
-- Besides the utility fees (0055, each its own line with the expenses), a
-- statement can carry other fees: what each is for and its amount, entered
-- when generating. They come off the net payout; the owner's statement shows
-- only their sum, as one "Other charges" line, and never what they were for.
-- The list stays on the statement for staff (owner_statements.other_charges).
--
--   net payout = income - expenses - fee - VAT on the fee
--                - utility fees - other fees
-- ============================================================================

alter table owner_statements
  add column if not exists other_charges_aed numeric(14,2) not null default 0
    check (other_charges_aed >= 0),
  add column if not exists other_charges jsonb not null default '[]'::jsonb;

comment on column owner_statements.other_charges_aed is
  'Other fees deducted on this statement; the owner sees only this sum, as "Other charges".';
comment on column owner_statements.other_charges is
  'What each other fee was for, with its amount: for staff only, never on the owner''s statement.';

drop function if exists generate_owner_statement(uuid, date, date, numeric, boolean, jsonb);

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
    raise exception 'Other fees must be a list' using errcode = 'invalid_parameter_value';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    if length(trim(coalesce(v_item->>'description', ''))) not between 1 and 200
       or (v_item->>'amount') is null or (v_item->>'amount')::numeric <= 0 then
      raise exception 'Each other fee needs what it is for and an amount above 0'
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
  -- not already been carried on another statement.
  for r in
    select le.*, gc.code as category_code, gc.affects_owner_statement,
           u.unit_number, p.name as property_name
    from ledger_entries le
    join gl_categories gc on gc.id = le.category_id
    left join units u on u.id = le.unit_id
    left join properties p on p.id = u.property_id
    where le.owner_id = p_owner_id
      and le.entry_date between p_period_start and p_period_end
      and le.statement_id is null
      and le.is_owner_visible
      and gc.affects_owner_statement
      and gc.code <> 'EXP-MGMT-FEE'      -- the fee is computed below, not copied
    order by le.entry_date, le.created_at
  loop
    v_sort := v_sort + 1;

    insert into owner_statement_lines (
      statement_id, ledger_entry_id, unit_id, unit_label, entry_date,
      category_code, description, direction, amount_aed, vat_amount_aed,
      total_aed, sort_order
    ) values (
      v_statement_id, r.id, r.unit_id,
      coalesce(r.property_name || ' - ' || r.unit_number, 'Portfolio'),
      r.entry_date, r.category_code, r.description, r.direction,
      r.amount_aed, r.vat_amount_aed, r.total_aed, v_sort
    );

    update ledger_entries set statement_id = v_statement_id where id = r.id;

    if r.direction = 'income' then
      v_income := v_income + r.amount_aed;
    else
      v_expense := v_expense + r.total_aed;
    end if;
  end loop;

  if p_fee_pct is not null then
    -- The fee finance set: one line on the period's whole income.
    v_fee     := round(v_income * p_fee_pct / 100.0, 2);
    v_fee_vat := case when p_fee_vat then round(v_fee * v_vat_rate, 2) else 0 end;
    if v_fee > 0 then
      v_sort := v_sort + 1;
      insert into owner_statement_lines (
        statement_id, unit_label, entry_date, category_code,
        description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
      ) values (
        v_statement_id, 'Portfolio', p_period_end, 'EXP-MGMT-FEE',
        'Management fee (' || rtrim(rtrim(p_fee_pct::text, '0'), '.') || '% of AED '
          || to_char(v_income, 'FM999,999,990.00') || ')',
        'expense', v_fee, v_fee_vat, v_fee + v_fee_vat, v_sort
      );
    end if;
  else
    -- Management fee, per unit, from the agreement in force during the period.
    for r in
      select ma.unit_id, ma.commission_pct, ma.fixed_fee_aed, ma.fee_vat_applicable,
             u.unit_number, p.name as property_name,
             coalesce(sum(le.amount_aed) filter (where le.direction = 'income'), 0) as unit_income
      from management_agreements ma
      join units u on u.id = ma.unit_id
      join properties p on p.id = u.property_id
      left join ledger_entries le
        on le.unit_id = ma.unit_id
       and le.statement_id = v_statement_id
       and le.direction = 'income'
      where ma.owner_id = p_owner_id
        and ma.is_active
        and ma.start_date <= p_period_end
        and ma.end_date >= p_period_start
      group by ma.unit_id, ma.commission_pct, ma.fixed_fee_aed, ma.fee_vat_applicable,
               u.unit_number, p.name
    loop
      declare
        line_fee numeric(14,2);
        line_vat numeric(14,2);
      begin
        if r.commission_pct is not null then
          line_fee := round(r.unit_income * r.commission_pct / 100.0, 2);
        else
          line_fee := coalesce(r.fixed_fee_aed, 0);
        end if;

        if line_fee <= 0 then
          continue;
        end if;

        -- Management fee is a taxable supply of services: VAT normally applies.
        line_vat := case when r.fee_vat_applicable then round(line_fee * v_vat_rate, 2) else 0 end;

        v_fee     := v_fee + line_fee;
        v_fee_vat := v_fee_vat + line_vat;
        v_sort    := v_sort + 1;

        insert into owner_statement_lines (
          statement_id, unit_id, unit_label, entry_date, category_code,
          description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
        ) values (
          v_statement_id, r.unit_id, r.property_name || ' - ' || r.unit_number,
          p_period_end, 'EXP-MGMT-FEE',
          case when r.commission_pct is not null
            then 'Management fee (' || r.commission_pct || '% of AED ' || r.unit_income || ')'
            else 'Management fee (fixed)' end,
          'expense', line_fee, line_vat, line_fee + line_vat, v_sort
        );
      end;
    end loop;
  end if;

  -- Other fees, one line each, as entered: on the statement under their own
  -- names, with the expenses.
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

  -- Other fees: no lines - the owner's statement shows their sum as one
  -- "Other charges" line; what each was for stays with staff (other_charges).
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
         net_payout_aed     = v_income - v_expense - v_fee - v_fee_vat - v_other - v_hidden,
         closing_balance_aed = v_income - v_expense - v_fee - v_fee_vat - v_other - v_hidden
   where id = v_statement_id;

  return v_statement_id;
end;
$$;

revoke all on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb) from public, anon;
grant execute on function generate_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb) to authenticated;
