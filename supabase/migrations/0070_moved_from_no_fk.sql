-- ============================================================================
-- D|R|P PMS - 0070 bookings.moved_from_unit_id without a foreign key
--
-- 0069 made bookings.moved_from_unit_id reference units. That gave bookings
-- two links to units, and the API could no longer tell which one a query's
-- "units(...)" embed means: booking pages answered 404 and lists failed.
-- The column stays (a plain unit id, set only by the bookings-sheet sync);
-- the constraint goes, and the API reloads its view of the schema.
-- ============================================================================

alter table bookings drop constraint if exists bookings_moved_from_unit_id_fkey;

notify pgrst, 'reload schema';
