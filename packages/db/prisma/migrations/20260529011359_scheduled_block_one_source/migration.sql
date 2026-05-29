-- Exactly one of taskId / habitId must be set on a scheduled block.
ALTER TABLE "ScheduledBlock"
  ADD CONSTRAINT "scheduled_block_one_source"
  CHECK ((("taskId" IS NOT NULL)::int + ("habitId" IS NOT NULL)::int) = 1);