-- ============================================================================
-- D|R|P PMS - 0030 Sleeping arrangements on the Holiday Homes website
--
-- "Where you'll sleep" on a home's website page: one row per room, e.g.
--   [{"room":"Bedroom 1","beds":"1 king bed"},{"room":"Living room","beds":"1 sofa bed"}]
-- Edited on the unit's Website tab; sent to the website by /api/public/homes.
-- ============================================================================

alter table units
  add column if not exists website_beds jsonb not null default '[]'::jsonb
    check (jsonb_typeof(website_beds) = 'array');

comment on column units.website_beds is 'Sleeping arrangements shown on the Holiday Homes website: [{room, beds}].';
