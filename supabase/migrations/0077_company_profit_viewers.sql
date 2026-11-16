-- ============================================================================
-- D|R|P PMS - 0077 Who sees the company's profit on owner statements
--
-- What D|R|P keeps from a statement - the management fee (before VAT, which
-- goes to the FTA) and the booking adjustments taken off the owner's rent -
-- is shown per property only to the people listed in
-- company_settings.profit_viewer_ids: Jasko and Dulshan. Only an
-- administrator can change the list (company_settings_write).
-- ============================================================================

alter table company_settings
  add column if not exists profit_viewer_ids uuid[] not null default '{}';

comment on column company_settings.profit_viewer_ids is
  'Staff who see the company profit (management fee and booking adjustments) on owner statements.';

update company_settings
   set profit_viewer_ids = (
     select coalesce(array_agg(p.id order by p.created_at), '{}')
       from profiles p
      where p.is_active
        and p.role not in ('owner', 'tenant', 'guest')
        and (p.full_name ilike 'jasko%' or p.email ilike 'jasko%'
             or p.full_name ilike 'dulshan%' or p.email ilike 'dulshan%'))
 where id and profit_viewer_ids = '{}';

create or replace function can_see_company_profit()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.is_active
       and p.id = any (coalesce((select profit_viewer_ids from company_settings where id), '{}'))
  );
$$;

revoke all on function can_see_company_profit() from public, anon;
grant execute on function can_see_company_profit() to authenticated;

notify pgrst, 'reload schema';
