# Doc AI rebuild, Piece 1: Universal Vault and Lifecycle

Plan for Tony's sign-off. No code is written yet. Built on `main` at
`891a5ea`, branch `claude/docai-piece1`, migration `0048`. The View As
branch (`claude/stage5-phase5-viewas`, migration `0047`) is not merged and
stays that way until the end; the overlap with it is listed under Risks.

Piece 1 only. No AI classification, no extraction, no identity matching,
no preview rendering, no family or personal uploads. Pieces 2 to 9 are
untouched.

## 0. Decisions I need from Tony

Each has a recommendation. The plan below is written to the recommendation.

1. **Same file twice.** Today a duplicate (same SHA-256 in the org) is
   refused and its upload is deleted. That is a rejection and a delete.
   Recommend: store it anyway as its own document, do not run the paid
   reader on it, land it in Needs Review with "Same file as <name>
   uploaded <date>".
2. **Uploads that fail checks leave a stray file.** The browser uploads to
   storage first, then the server checks. A file the server refuses (wrong
   signature, tampered client) would sit in the bucket with no row, which
   is an orphan. Recommend one narrow exception to "no deletes from the
   app": the server may remove an upload that never got a document row,
   through the service role, only for paths under the caller's org and
   request folder that no row references. Nothing that ever had a row can
   be removed by anyone. The alternative (leave refused files in the
   bucket) breaks "no orphans" in the other direction.
3. **Images are not stored untouched today.** The browser shrinks every
   photo to 2000px and turns a large PNG into a JPEG before upload, and
   that shrunk copy is the only thing stored. To keep originals untouched
   the browser must upload the original as is. Recommend: for a file
   someone tagged with an old type, the browser also uploads a shrunk
   "reader copy" next to the original and the existing reader keeps reading
   that, so typed photos behave exactly as today. Untagged photos get no
   copy. The alternative (reader gets the raw photo) risks the model's
   image size limit for large phone photos; it would land in Needs Review
   with the reason, never lost, but is a regression for the old path.
4. **"Detect it" goes away for untagged files.** Today an untagged upload
   runs AI type detection. Your spec says untagged files go straight to
   Needs Review with no AI, so that default changes to "No Type". The six
   types stay selectable and still read as today. Confirm this is intended.
5. **GIF and WebP stop being accepted.** They are in the bucket today but
   are not among the seven formats. Recommend following the seven.
6. **Old rows: applied maps to Needs Review, not Ready.** Ready is never
   automatic, so I do not want the migration to mark anything Ready.
   (Production has 0 document rows today; this affects fixtures and tests.)
7. **A mixed selection.** If one file in a selection is outside the seven,
   recommend refusing the whole selection and naming the file, rather than
   uploading some and not others (a multi-page typed upload is one
   document, so partial does not make sense there).
8. **No "send back to review" from Ready.** Mark Ready is undone by
   Archive then Unarchive (lands in Needs Review). Add a direct Ready to
   Needs Review move only if you want it.
9. **Hosted preview.** See section 9: the app refuses fixture mode on
   Vercel on purpose, and a preview on Vercel would otherwise run against
   the production database before the migration is applied. Recommend
   allowing fixture mode on Vercel PREVIEW deployments only (never
   production), for this one branch.

## 1. What I found in the current code

- **Upload path today.** `DocumentUploader` (client) reads each file,
  sniffs it (PDF, JPEG, PNG, GIF, WebP; HEIC refused), shrinks images,
  uploads the result to the `documents` bucket at
  `<org>/<requestId>/<n>-<name>`, then calls `processDocument`, which reads
  the bytes back, validates, hashes (SHA-256 over all files of the upload),
  inserts the row as `processing`, logs `document_uploaded`, and runs the
  reader. A multi-file selection is ONE document of N pages.
- **Destructive spots.** `dropStored` deletes the upload when a file is
  refused or is a duplicate. `deleteDocument` removes the files and the
  row. The `documents_delete` policy (staff) and the storage
  `documents_bucket_delete` policy allow both.
- **The mismatch rejection.** `pipeline.ts` returns
  `stage: "triage_wrong_category"` ("This looks like X, not a Y"). The
  caller marks the row `failed`, which the list shows under "Not Used" and
  the detail screen offers to delete. A reader error, a timeout and an
  "undetected" type are also `failed`. Nothing is lost today (the row and
  file stay) but it reads as a rejection and is deletable.
- **Auto-apply exists** (`route = auto_apply`, only with a real model and a
  confident match). It stays as is. Applying never marks anything Ready.
- **Statuses today** (`doc_status`): processing, pending, applied,
  discarded, failed, filed (`filed` = a file an Athlete login sent in with
  an assignment, never read).
- **Policies today** (checked on production). `documents`: read for staff
  (`_member_org_ids`) and for the family of the athlete, insert/update/
  delete for staff. `storage.objects` for the `documents` bucket: read for
  staff, insert for staff and for the family's own folder, delete for
  staff, no update policy (so a stored object cannot be overwritten).
  A Viewer (the board) reads nothing.
- **Bucket today** (checked on production): private, 10,485,760 bytes (10
  MB), allowed types `application/pdf`, `image/jpeg`, `image/png`,
  `image/gif`, `image/webp`. `documents` has 0 rows and the bucket has 0
  objects on production right now.
- **Reader supports** PDF and JPG/PNG only. DOC, DOCX, XLS, XLSX, CSV, TXT
  can be stored but cannot be read; a file of those formats that someone
  tagged with a type skips the reader and goes to Needs Review with the
  reason "The reader reads PDF, JPG and PNG. Stored as is."
- **A fixture-mode guard** in `next.config.ts` throws if `FIXTURE_MODE=1`
  on a Vercel build.

## 2. Formats and file checks

Seven formats, nine extensions:

| Format | Extensions | Signature check (pure function, tested) |
| --- | --- | --- |
| PDF | .pdf | starts `%PDF` |
| Word | .docx | ZIP (`PK`) and the zip lists `word/document.xml` |
| Word, old | .doc | OLE2 header `D0 CF 11 E0 A1 B1 1A E1` |
| Excel | .xlsx | ZIP and the zip lists `xl/workbook.xml` |
| Excel, old | .xls | OLE2 header |
| CSV | .csv | text (see below) |
| Image | .jpg, .jpeg | `FF D8 FF` |
| Image | .png | `89 50 4E 47 0D 0A 1A 0A` |
| Text | .txt | text |

- **Extension and signature must agree.** The extension picks the format,
  the bytes must match it. A `.jpg` that is a PNG, a `.docx` that is a
  plain zip, or a `.pdf` that is text is refused. The browser's MIME claim
  is never used.
- **Text** means: no NUL bytes in the first 8 KB, valid UTF-8 or a UTF-16
  byte order mark. Anything binary is refused.
- **Honest limit:** `.doc` and `.xls` share one container, so they are
  told apart by extension only (both must have the OLE2 header). The pure
  zip check reads the zip's central directory, no library.
- **Refusal message** (plain, same everywhere): "<file> is not a format
  Doc AI stores. It takes PDF, Word (DOC, DOCX), Excel (XLS, XLSX), CSV,
  JPG, PNG and TXT." with a second sentence when the cause is a mismatch:
  "Its contents are a PNG but its name says JPG."
- **Size:** 10 MB stays (enforced by the bucket and again server side).
  A normal transcript PDF fits (the limit was set to 10 MB for this in
  migration 0029). Stated per the pass-off: bucket limit before 10 MB,
  after 10 MB.
- **Bucket allowed types after:** `application/pdf`, `application/msword`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  `application/vnd.ms-excel`,
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `text/csv`, `text/plain`, `image/jpeg`, `image/png`. (GIF and WebP
  removed.) The browser uploads with the canonical type for the checked
  format, not the type the OS guessed.
- **One side effect to accept:** the bucket list is shared, so an Athlete
  login's assignment upload (which reads the bucket's allowed types) could
  now send a Word or Excel file through the API. Its own picker still only
  offers PDF, JPG and PNG. Nothing there is read. Not changed in this piece.
- **File picker:** `accept` lists the nine extensions.

## 3. Migration `0048_document_vault.sql`

Additive, one transaction, reversible (down script below). Production
`documents` has 0 rows, so the backfill touches nothing there; it is
written and tested for the rows that exist in fixtures.

```
create type doc_lifecycle as enum
  ('uploaded', 'processing', 'needs_review', 'ready', 'archived');

alter table documents
  add column lifecycle      doc_lifecycle not null default 'needs_review',
  add column format         text,
  add column uploaded_by    uuid references users(id) on delete set null,
  add column review_reason  text,
  add column original_paths text[] not null default '{}';
```

- `lifecycle` is the new five-state field. The old `status` column is
  untouched: it stays the internal state of the existing reader, review,
  apply and undo flow, so that flow does not move. A row has both.
- `content_hash` is already the SHA-256 of the stored bytes (for a
  single-file document, exactly the file's hash; for a legacy multi-page
  document, the hash of all pages in order). It is reused, not duplicated.
  `file_name`, `file_size`, `media_type`, `created_at` (= uploaded time)
  already exist. `format` and `uploaded_by` are new. `media_type` now holds
  the canonical type, not the browser's claim.
- `original_paths` are the untouched uploaded bytes. `storage_paths` stays
  what the reader reads (for a PDF or an untagged file it is the same
  object; for a tagged photo it is the reader copy).
- `review_reason` is the one-line reason shown on the row, such as
  "Did not look like Transcript" or the reader's error.
- Index `documents_org_lifecycle_idx (org_id, lifecycle, created_at desc)`.
- Five new `activity_action` values: `document_reading`,
  `document_needs_review`, `document_ready`, `document_archived`,
  `document_unarchived` (with templates in `src/lib/data/activity.ts` and
  the existing law that every action has a template).
- Bucket: `update storage.buckets set allowed_mime_types = ... where id =
  'documents'` (size limit not touched).

**Status mapping for existing rows (nothing deleted):**

| Old `status` | New `lifecycle` | `review_reason` |
| --- | --- | --- |
| processing | needs_review | "Reading did not finish." |
| pending | needs_review | none |
| applied | needs_review (decision 6) | none |
| discarded | archived | none |
| failed | needs_review | the old `failure_reason` |
| filed (family upload) | needs_review | none |

`format` is backfilled from `media_type`; `original_paths` is set equal to
`storage_paths` for old rows (for an old photo these are the only bytes
that were ever stored, and the screen says nothing different); `uploaded_by`
stays null for old rows (not recorded then).

**Database rules (triggers, so a bug in the app cannot break them):**

- `documents_file_exists` (before insert): every path in `storage_paths`
  and `original_paths` must exist in `storage.objects` for the bucket
  `documents`. A row cannot point at a missing file. Security definer,
  empty search path. This covers the family RPC too (it already checks).
- `documents_original_is_immutable` (before update): `org_id`, `file_name`,
  `file_size`, `media_type`, `format`, `content_hash`, `storage_paths`,
  `original_paths`, `uploaded_by`, `created_at` cannot change once set.
  (Verified: existing code writes these only at insert.)
- `documents_lifecycle_transition` (before update of `lifecycle`): only the
  allowed pairs in section 5; anything else raises.

**Removing destruction:**

- Drop policy `documents_delete` on `documents` and
  `documents_bucket_delete` on `storage.objects`. With RLS on and no delete
  policy nobody signed in can delete a row or an original. There is still
  no update policy on `storage.objects`, so an original cannot be
  overwritten. The service role (used only on the server) can still act;
  the code law in section 8 pins that no app code deletes a document row,
  and that the only storage removal is the unconfirmed-upload cleanup in
  decision 2.

**RLS otherwise unchanged:** read stays staff plus the athlete's family;
insert and update stay staff. A Viewer (the board) reads nothing. New
columns inherit this. Planted-to-fail cases in section 8.

**Down script** (kept in this plan, not applied): drop the three triggers,
recreate the two delete policies, drop the five columns and the type
(`activity_action` values cannot be dropped and are left, unused), restore
the bucket's allowed types.

## 4. Upload flow (no orphans in either direction)

1. **Browser, before anything is sent:** classify every file with the pure
   function (extension and signature, size). Any failure refuses the whole
   selection with the section 2 message. Nothing is uploaded.
2. **Browser:** upload each original, bytes untouched, to
   `<org>/<requestId>/<n>-<safe name>` with the canonical content type,
   `upsert: false`. For a tagged photo, also upload the shrunk reader copy
   as `<org>/<requestId>/reader-<n>-<safe name>` (decision 3).
3. **Server action `registerUploads`** (replaces the first half of
   `processDocument`): staff only. For each path: it must be under this
   org and this request folder; the server downloads the object (this is
   the "confirmed in storage" step, through the caller's own client so
   storage policy applies), re-runs the same classification on the real
   bytes, checks size, computes the SHA-256. If any step fails for any
   file, no row is written and the unreferenced objects are removed by the
   cleanup helper (decision 2); the caller gets the plain message.
4. **Only then** insert the row(s) with `lifecycle = uploaded`,
   `uploaded_by = user`, `format`, canonical `media_type`, `content_hash`,
   `original_paths`, `storage_paths`. An untagged selection makes one
   document per file. A tagged selection keeps today's behavior: one
   document of N pages (the legacy path, exactly as now).
5. Log `document_uploaded` (existing), then transition (section 5).

**Orphan guarantees:** (a) no row without a confirmed file: the
read-back precedes the insert, and the database trigger re-checks it;
(b) no file without a row: failure before the insert removes the
unreferenced objects, and nothing can remove an object that has a row.
Residual case: a browser tab closed between step 2 and 3 leaves an
unregistered object. A read-only report script
(`scripts/list_unregistered_uploads.mjs`) lists them; nothing is deleted
automatically. Stated in the QA report as a known limit.

## 5. The five statuses and the allowed moves

| From | To | Who and when |
| --- | --- | --- |
| uploaded | processing | system, only when the file is a PDF/JPG/PNG tagged with one of the six types |
| uploaded | needs_review | system, every other file (untagged, or a format the reader cannot read) |
| processing | needs_review | system, always when the reader ends: success, mismatch, error, timeout |
| needs_review | ready | staff, "Mark Ready" |
| needs_review | archived | staff, "Archive" |
| ready | archived | staff, "Archive" |
| archived | needs_review | staff, "Unarchive" |

Nothing else is allowed (no Ready without passing through Needs Review,
nothing skips Processing, nothing leaves Processing except to Needs
Review). Enforced in three places: the pure `LIFECYCLE_TRANSITIONS` map in
`src/lib/vault/lifecycle.ts`, a single server function that every action
uses (conditional update on the current state, so two taps cannot race),
and the database trigger. Every transition writes the activity log
(existing table) with the actor and time. Existing "Discard" (undoes what
an apply changed) also archives the document; "Delete" is removed.

**Stuck Processing:** if the server dies mid-read the row would stay in
Processing. After 10 minutes the screen shows "Reading did not finish" and
staff get a "Move to Needs Review" button (same allowed move, same log).
No background job and no service-role call from a page.

**The reader, unchanged except the ending.** The six types, the extraction,
review, apply, auto-apply and undo flow are untouched. What changes:
`readAndFile` runs inside the Processing state and always ends by moving
the row to Needs Review. A mismatch (`triage_wrong_category`), a reader
error, a timeout, an unsupported type and a low-confidence result all set
`review_reason` ("Did not look like Transcript", the reader's own error
text, etc.) and keep the file. The old internal `status = failed` stays so
the legacy review screens keep working; it is no longer a user-facing word.

## 6. Screens (kit only, Title Case, no raw elements)

- **Documents list.** Each row shows the status pill (Uploaded,
  Processing, Needs Review, Ready, Archived), file name, format, size, and
  `review_reason` when present; plus today's type and athlete info when the
  old reader produced it. Sections by status in that order; Archived is
  hidden unless "Show Archived" is on. Search unchanged.
- **Document screen.** Status pill at the top. A new "Original File"
  section: name, format, size, uploaded by and when, SHA-256. For every
  file: a Download link. Non-image files show no preview (no preview work
  in this piece). Buttons by state: Mark Ready and Archive (Needs Review),
  Archive (Ready), Unarchive (Archived), Move to Needs Review (stale
  Processing). The old Delete button and its confirm sheet are removed.
  The old Apply, Discard, Correct and review sections are unchanged.
- **Add screen.** The chooser becomes "No Type" (default, stored, goes to
  Needs Review) plus the six types. Picker lists the nine extensions.
  Refusals show a Notice with the section 2 message.
- **Download.** A route handler
  `/org/<slug>/documents/<id>/download?n=<page>`: staff only, streams the
  stored bytes with the canonical type, `Content-Disposition: attachment`
  and `X-Content-Type-Options: nosniff`. No public or signed URL is handed
  out, so nothing can be shared by link.
- Same screens, same roles as today. No family or personal upload.

## 7. Reader formats and what is out

Out of scope and untouched: classification (Piece 2), extraction (3),
identity matching (4), family and personal uploads (5, 8), approver roles
and legacy migration (7 to 9), previews. Approver roles (academic,
eligibility, financial) are recorded in `docs/ROADMAP.md` for Piece 7 and 8
with names unassigned, as part of the docs update.

## 8. Tests

New `src/laws/vaultLaws.test.ts` and additions, all with planted-to-fail
proof (revert the behavior, watch the test fail, restore):

- **Formats:** each of the seven accepted from real signature bytes
  (synthetic files built in the test); wrong extension for the bytes,
  spoofed browser type, zip that is not a docx or xlsx, binary renamed
  `.txt`, empty file, over 10 MB, GIF, WebP, HEIC: each refused with the
  message naming the seven.
- **Originals:** the stored bytes equal the uploaded bytes (hash match) for
  every format, including a large PNG that the old path would have shrunk.
- **Orphans, one test each:** a failed upload leaves no row; a row is never
  written when the object is missing; a refused file leaves no object in
  the bucket; an object that has a row cannot be removed by the cleanup.
- **Statuses:** every allowed pair works; every disallowed pair is refused
  by the function and by the database trigger; each transition writes the
  activity log with actor and time; stale Processing offers the move.
- **Mismatch and reader failure:** a transcript tag on a non-transcript
  lands in Needs Review with "Did not look like Transcript" and the file
  intact; a reader error and a timeout do the same with their reason.
- **Old path:** the six types still read, review, apply and undo as before
  (existing tests stay and pass; ones that pinned Delete are rewritten to
  Archive); an old-type transcript through the stub reader still ends
  applied or pending as today, and in Needs Review on the new field.
- **No delete:** a source scan law fails on any `.delete()` on `documents`
  or `.remove(` on the bucket outside the one cleanup helper.
- **RLS** (`scripts/rls_test.sql`, real Postgres with the stubbed auth
  schema, planted to fail): staff cannot delete a document row; staff
  cannot delete a bucket object; staff cannot change any immutable column;
  staff cannot make a disallowed lifecycle move; an insert pointing at a
  missing object fails; a Viewer and a signed-out client read no documents;
  the family reads only its own athlete's rows; another org's staff reads
  nothing; the new columns do not widen any read.
- **Screens and routes:** list and document screens render all five
  statuses, hide Archived by default, show the buttons only to staff, the
  download route refuses non-staff and sets the headers; render law and
  kit and copy laws pass (Title Case, no em dash).
- **Browser (e2e, fixture build):** one upload per format (7), a mismatched
  file landing in Needs Review, Mark Ready, Archive, Unarchive, and an
  old-type transcript through the stub reader. No real model call is made
  anywhere; the stub reader is used.

Full gate: `npm test`, typecheck, build, lint (house rules, em-dash
baseline, secret scan), RLS suite, e2e, `scripts/build_previews.sh`
audit, and the live driver at 320/375/390.

## 9. Preview and the review walk

- The spec asks for a preview URL. A Vercel preview of this branch would
  run against the PRODUCTION Supabase project (the preview environment
  holds the same keys) before migration 0048 exists there, so every upload
  on it would fail, and any test upload that did work would write test data
  into production. I will not do that.
- `next.config.ts` also forbids fixture mode on Vercel on purpose.
- Recommendation (decision 9): allow fixture mode on Vercel only when
  `VERCEL_ENV` is `preview` (never `production`), pinned by a law test that
  a production build still throws, and set `FIXTURE_MODE=1` for this one
  branch's preview only. The preview is then a self-contained app on
  synthetic data (the fixture has no real names; roles and names only).
  Vercel Authentication is off, so the URL is public; it holds no real
  data. This needs Dave's or Tony's yes before I change a Vercel setting.
- Without that yes: the 390px light and dark screenshots (7 formats,
  mismatch, Mark Ready, Archive, Unarchive, old-type transcript) come from
  the local fixture build and go in the QA report; Dave cannot try uploads
  in a hosted preview.

## 10. Safety and release

- **Production migration only at merge,** and only after a backup or
  point-in-time recovery for project `emllcefqxyxyhqolrllo` is confirmed.
  As of today it is NOT confirmed: Dave is checking the dashboard. If it
  is still unconfirmed at merge time I stop and report.
- The migration is additive and the production `documents` table and
  bucket are empty, so the data risk is low; the rule stands regardless.
- The two Sept 26 backup tables are not touched, altered or read.
- No data is deleted, no keys are added, no paid service is used. Test
  data is synthetic, name and role only.
- I stop before merge. Tony reviews, then Dave verifies.

## 11. Risks and the View As branch

- **View As (`0047`)** adds `requireNotViewing()` to the eight document
  actions and rewrites every delete policy and every `storage.objects`
  policy. When it merges later it will conflict in `documents.ts` (small,
  mechanical) and must re-run its policy rewrite over a table whose delete
  policies are already gone; its new migration number stays above 0048.
  New actions in Piece 1 (`registerUploads`, the lifecycle actions, the
  download route) are written so adding the guard is one line each. Not
  merged, not rebased now, per Dave.
- **Behavior changes to the old path,** all listed above: no detection for
  untagged files, GIF and WebP no longer accepted, duplicates stored not
  refused, Delete removed, multi-file untagged uploads become one document
  per file.
- **`doc` vs `docx`/`xls` detection** relies on extension for the legacy
  Office formats; stated as a limit.
- **Docs to update at the end:** `CURRENT_STATE.md`, `DECISIONS.md`,
  `ROADMAP.md`; QA report published to basecode-qa.

## 12. Build order (after sign-off)

1. Pure modules and tests (`format.ts`, `lifecycle.ts`).
2. Migration 0048, local Postgres RLS cases (planted), down script check.
3. Server actions, download route, activity templates, fake client.
4. Screens, uploader, copy and kit laws.
5. Existing tests updated, e2e, previews audit, live driver.
6. Docs, QA report, screenshots. Stop before merge.
