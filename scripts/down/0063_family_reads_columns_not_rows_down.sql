-- Undo 0063: drop the family read functions (undo 0065 first).
drop function if exists public.family_document_twin(uuid, text);
drop function if exists public.family_documents(uuid, uuid);
drop function if exists public.family_target_visits(uuid, uuid[]);
drop function if exists public.family_targets(uuid, uuid[]);
