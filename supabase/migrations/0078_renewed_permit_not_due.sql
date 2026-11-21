-- ============================================================================
-- D|R|P PMS - 0078 A renewed DET permit stops raising compliance alerts
--
-- When a permit is renewed, the old one stays "active" until its last day,
-- so the compliance calendar kept flagging it (and its building NOC) as
-- expiring even though the unit's new permit runs on. A permit with a later
-- active permit for the same unit is now left out of the calendar.
-- ============================================================================

create or replace function pms.permit_renewed(p_permit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1
      from holiday_home_permits old
      join holiday_home_permits n
        on n.unit_id = old.unit_id and n.id <> old.id
     where old.id = p_permit_id
       and n.status = 'active'
       and n.expires_on > old.expires_on
  );
$$;

create or replace view v_compliance_calendar
with (security_invoker = true)
as
with settings as (select * from company_settings where id)
-- Ejari registration expiry
select
  'ejari_expiry'::compliance_kind as kind,
  'lease'::document_entity        as entity_kind,
  l.id                            as entity_id,
  l.unit_id,
  null::uuid                      as owner_id,
  'Ejari ' || coalesce(l.ejari_contract_number, l.lease_number) as label,
  l.ejari_expiry                  as due_date,
  (l.ejari_expiry - current_date) as days_remaining
from leases l
where l.ejari_status = 'registered'
  and l.ejari_expiry is not null
  and l.status in ('active','expiring')

union all
-- Ejari occupant declaration staleness (2026 30-day data-currency rule).
-- Due date = the deadline by which Ejari must be updated.
select
  'ejari_occupant_declaration'::compliance_kind,
  'lease'::document_entity,
  l.id,
  l.unit_id,
  null::uuid,
  'Ejari occupant details - ' || l.lease_number,
  (oc.last_change::date + (select ejari_occupant_update_days from settings)),
  (oc.last_change::date + (select ejari_occupant_update_days from settings)) - current_date
from leases l
join lateral (
  select max(greatest(o.updated_at, o.created_at)) as last_change
  from lease_occupants o
  where o.lease_id = l.id and o.removed_on is null
) oc on true
where l.status in ('active','expiring')
  and oc.last_change is not null
  -- Stale = occupants changed since the last push to Ejari (or never pushed).
  and (l.ejari_occupants_synced_at is null
       or l.ejari_occupants_synced_at < oc.last_change)

union all
-- Lease expiry itself
select
  'lease_expiry'::compliance_kind,
  'lease'::document_entity,
  l.id,
  l.unit_id,
  null::uuid,
  'Tenancy ' || l.lease_number,
  l.end_date,
  l.end_date - current_date
from leases l
where l.status in ('active','expiring')

union all
-- DET holiday home permit
select
  'det_permit_expiry'::compliance_kind,
  'permit'::document_entity,
  hp.id,
  hp.unit_id,
  null::uuid,
  'DET permit ' || hp.permit_number,
  hp.expires_on,
  hp.expires_on - current_date
from holiday_home_permits hp
where hp.status = 'active'
  and not pms.permit_renewed(hp.id)

union all
-- Building NOC backing the permit
select
  'building_noc_expiry'::compliance_kind,
  'permit'::document_entity,
  hp.id,
  hp.unit_id,
  null::uuid,
  'Building NOC ' || coalesce(hp.noc_reference, ''),
  hp.noc_expires_on,
  hp.noc_expires_on - current_date
from holiday_home_permits hp
where hp.status = 'active' and hp.noc_expires_on is not null
  and not pms.permit_renewed(hp.id)

union all
-- Management agreement
select
  'management_agreement_expiry'::compliance_kind,
  'management_agreement'::document_entity,
  ma.id,
  ma.unit_id,
  ma.owner_id,
  'Management agreement ' || coalesce(ma.agreement_number, ''),
  ma.end_date,
  ma.end_date - current_date
from management_agreements ma
where ma.is_active

union all
-- Any document in the vault carrying an expiry date
select
  case d.kind
    when 'insurance_policy' then 'insurance_expiry'
    when 'emirates_id'      then 'emirates_id_expiry'
    when 'passport'         then 'passport_expiry'
    when 'trade_licence'    then 'trade_licence_expiry'
    else 'document_expiry'
  end::compliance_kind,
  d.entity_kind,
  d.id,
  d.unit_id,
  d.owner_id,
  d.title,
  d.expires_on,
  d.expires_on - current_date
from documents d
where d.expires_on is not null

union all
-- Preventive maintenance
select
  'preventive_maintenance'::compliance_kind,
  'unit'::document_entity,
  pm.id,
  pm.unit_id,
  null::uuid,
  pm.title,
  pm.next_due_on,
  pm.next_due_on - current_date
from preventive_maintenance_plans pm
where pm.is_active

union all
-- Fleet
select
  'vehicle_registration'::compliance_kind,
  'vehicle'::document_entity,
  v.id, null::uuid, null::uuid,
  'Mulkiya ' || v.plate_number,
  v.registration_expiry,
  v.registration_expiry - current_date
from vehicles v
where v.is_active and v.registration_expiry is not null

union all
select
  'vehicle_insurance'::compliance_kind,
  'vehicle'::document_entity,
  v.id, null::uuid, null::uuid,
  'Vehicle insurance ' || v.plate_number,
  v.insurance_expiry,
  v.insurance_expiry - current_date
from vehicles v
where v.is_active and v.insurance_expiry is not null;


notify pgrst, 'reload schema';
