-- Stage 5, Phase 4: a new document status, alone in its own file.
-- Dave approved the plan 2026-09-27 (docs/PLAN_STAGE5.md, "Phase 4:
-- Assignments").
--
-- 'filed' is what a document is when an Athlete login hands it in with
-- an assignment: kept, linked to the assignment and to the athlete,
-- never read by Doc AI, never in Needs Review, never with an Apply
-- button. Without a value of its own it would have to pose as
-- 'applied' (nothing was applied) or 'pending' (nothing is waiting on a
-- reviewer), and either lie puts a family's file in a staff queue.
--
-- Its own file because Postgres refuses to use a new enum value in the
-- transaction that adds it (the lesson of migration 0022); the function
-- in 0046 that writes the value runs later, so the value is committed
-- before anything uses it.
--
-- No data, and safe to run twice.

alter type doc_status add value if not exists 'filed';
