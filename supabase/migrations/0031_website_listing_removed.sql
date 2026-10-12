-- ============================================================================
-- D|R|P PMS - 0031 Deleting a Property Finder listing from the website
--
-- Property Finder listings come from Property Finder, not from this table, so
-- deleting the portal's copy of one used to bring Property Finder's version
-- back on the website. "removed" keeps the web address here as a marker
-- instead: /api/public/listings/hidden lists it and the website leaves the
-- listing off, for good. The portal shows these only on the Property Finder
-- page, where Restore deletes the marker.
-- ============================================================================

alter table website_listings drop constraint if exists website_listings_status_check;
alter table website_listings add constraint website_listings_status_check
  check (status in ('draft', 'published', 'hidden', 'removed'));

comment on column website_listings.status is
  'draft | published | hidden | removed (a Property Finder listing deleted from the website; only the address is used).';
