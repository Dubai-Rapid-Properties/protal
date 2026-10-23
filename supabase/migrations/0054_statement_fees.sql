-- ============================================================================
-- D|R|P PMS - 0054 Statement fees set when generating; voiding frees the lines
--
-- The management fee differs from owner to owner, so finance sets it on each
-- statement: generate_owner_statement() takes the fee as a percentage of the
-- period's income (with or without VAT on it) and an "other fees" amount with
-- what it is for. Without a percentage it falls back to the unit's
-- management agreement, as before (0011).
--
-- The arithmetic, in AED to the fils:
--   income      = sum of the period's income lines
--   expenses    = sum of the period's expense lines (with their VAT)
--   fee         = round(income x percentage / 100, 2)
--   VAT on fee  = round(fee x VAT rate, 2), when applied
--   other fees  = as entered
--   net payout  = income - expenses - fee - VAT on fee - other fees
--
-- Voiding a statement also frees its ledger lines and its owner and period,
-- so a corrected statement can be generated in its place. 0011 left both
-- taken: the replacement found no income, and the unique owner + period
-- refused it outright.
-- ============================================================================

alter table owner_statements
  add column if not exists management_fee_pct numeric(5,2)
    check (management_fee_pct is null or management_fee_pct between 0 and 100),
  add column if not exists fee_vat_applied boolean,
  add column if not exists other_fees_aed numeric(14,2) not null default 0
    check (other_fees_aed >= 0),
  add column if not exists other_fees_note text
    check (other_fees_note is null or length(other_fees_note) <= 200);

comment on column owner_statements.management_fee_pct is
  'The management fee finance set for this statement, as % of its income; null when it came from the agreements.';
comment on column owner_statements.other_fees_aed is
  'Other fees deducted on this statement, as entered when it was generated.';

-- One live statement per owner and period; void ones do not count.
alter table owner_statements drop constraint if exists owner_statements_owner_id_period_start_period_end_key;
create unique index if not exists owner_statements_live_period_idx
  on owner_statements (owner_id, period_start, period_end)
  where status <> 'void';

create or replace function pms.release_void_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void statement stays void; generate a new one'
      using errcode = 'check_violation';
  end if;
  if new.status = 'void' and old.status <> 'void' then
    update ledger_entries set statement_id = null where statement_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists owner_statements_release_void on owner_statements;
create trigger owner_statements_release_void
  before update of status on owner_statements
  for each row execute function pms.release_void_statement();

-- Lines of statements voided before this migration: free them too, unless
-- a live statement holds them.
update ledger_entries le
   set statement_id = null
  from owner_statements os
 where os.id = le.statement_id
   and os.status = 'void';


-- ---------------------------------------------------------------------------
-- generate_owner_statement: as 0011, with the fee and other fees given.
-- ---------------------------------------------------------------------------
drop function if exists generate_owner_statement(uuid, date, date);

create or replace function generate_owner_statement(
  p_owner_id        uuid,
  p_period_start    date,
  p_period_end      date,
  p_fee_pct         numeric default null,
  p_fee_vat         boolean default true,
  p_other_fees      numeric default 0,
  p_other_fees_note text default null
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
  v_other    numeric(14,2) := round(coalesce(p_other_fees, 0), 2);
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
  if v_other < 0 then
    raise exception 'Other fees cannot be negative' using errcode = 'check_violation';
  end if;

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
          p_fee_pct, case when p_fee_pct is not null then p_fee_vat end, v_other,
          nullif(trim(p_other_fees_note), ''))
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

  -- Other fees, as entered.
  if v_other > 0 then
    v_sort := v_sort + 1;
    insert into owner_statement_lines (
      statement_id, unit_label, entry_date, category_code,
      description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
    ) values (
      v_statement_id, 'Portfolio', p_period_end, 'EXP-OTHER-FEES',
      coalesce('Other fees: ' || nullif(trim(p_other_fees_note), ''), 'Other fees'),
      'expense', v_other, 0, v_other, v_sort
    );
  end if;

  update owner_statements
     set gross_income_aed   = v_income,
         total_expenses_aed = v_expense,
         management_fee_aed = v_fee,
         vat_total_aed      = v_fee_vat,
         other_fees_aed     = v_other,
         net_payout_aed     = v_income - v_expense - v_fee - v_fee_vat - v_other,
         closing_balance_aed = v_income - v_expense - v_fee - v_fee_vat - v_other
   where id = v_statement_id;

  return v_statement_id;
end;
$$;

revoke all on function generate_owner_statement(uuid, date, date, numeric, boolean, numeric, text) from public, anon;
grant execute on function generate_owner_statement(uuid, date, date, numeric, boolean, numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Deleting a statement: one account only (dulshan@dubairapidproperties.com).
-- Its lines go with it and its ledger lines are freed for a new statement
-- (ledger_entries.statement_id is "on delete set null").
-- ---------------------------------------------------------------------------
create or replace function pms.can_delete_statements()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid() and is_active
       and lower(email) = 'dulshan@dubairapidproperties.com'
  );
$$;

create or replace function delete_owner_statement(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if not pms.can_delete_statements() then
    raise exception 'Only dulshan@dubairapidproperties.com can delete a statement'
      using errcode = 'insufficient_privilege';
  end if;
  update ledger_entries set statement_id = null where statement_id = p_statement_id;
  delete from owner_statements where id = p_statement_id;
  if not found then
    raise exception 'Statement not found' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function delete_owner_statement(uuid) from public, anon;
grant execute on function delete_owner_statement(uuid) to authenticated;
