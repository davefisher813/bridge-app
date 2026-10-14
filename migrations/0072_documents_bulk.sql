-- 0072: bulk actions on the Documents list (Dave, 2026-10-13).
--
-- Setting the type of several documents at once writes one activity_log
-- row per document, like every other document change. Setting a type
-- had no log entry of its own, so the log gains one kind of event for
-- it. Additive: nothing else changes.

alter type activity_action add value if not exists 'document_typed';
