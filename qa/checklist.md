# Manual check: Doc AI rebuild, Piece 1 (the vault and its five states)

Commit: 52e7c58 (the commit this revision is built on; the revision itself is the next commit)
Date: 2026-10-08
Checked by: Claude Code, driving the FIXTURE_MODE build in headless Chromium at 390px, light and dark. Not a physical iPhone, and no hosted preview: the app refuses fixture mode on Vercel on purpose and a Vercel preview would run against the production database before migration 0048 exists.
QA report: qa/reports/latest.json
Preview: qa/previews/docai-piece1/, 38 shots
Result: pass

Every "Actual" is what the browser reported. The upload to Storage is
intercepted in the browser and the files are made-up bytes of each format;
the reader is the stand-in. Nothing reached Supabase or Anthropic. The
database rules (triggers, no delete, family folder, bucket types) are
proven on a real Postgres by scripts/rls_test.sql, not by this walk.

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Add screen | No Type first, the seven formats named, nine extensions in the picker | shown, light and dark | pass |
| 2 | Upload one file of each format (PDF, DOCX, DOC, XLSX, XLS, CSV, JPG, PNG, TXT) | Stored File, Needs Review, name, format, size, uploader, time, SHA-256, Download | 9 of 9 as expected; the downloaded bytes hash equal to the file picked | pass |
| 3 | Pick a PNG named .jpg | Refused in the browser, names the seven, nothing uploaded | refused, 0 uploads | pass |
| 4 | Tag a file Transcript that is not a transcript | Kept, Needs Review, "Did not look like Transcript", file intact | as expected | pass |
| 5 | Mark Ready, Archive, Show Archived, Unarchive | Ready; Archived and hidden from the list until asked; back in Needs Review | as expected, each in the activity log | pass |
| 6 | Tag a transcript, send it through the existing reader | Read, held for review, matched, old Apply flow unchanged | as expected | pass |
| 7 | List with every state | Each row carries its status; Archived hidden | as expected | pass |
| 8 | Every screen at 320, 375, 390, both themes, links followed | No finding, no broken link | 186 screens, 0 findings; 302 links, 0 broken | pass |
