-- Rows without a Google event id can only have been created in-app: the sync
-- path always writes both google ids. Relabel the pre-migration backfill.
UPDATE "CalendarEvent" SET "source" = 'app' WHERE "googleEventId" IS NULL;
