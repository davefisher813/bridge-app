# Launch actions, prepared and not run

One file per decision in the Bridge Launch Decisions form. Each runs only
after Dave says yes to that item. Each is one transaction with guards: if
production is not in the state the file expects, it raises and changes
nothing. Each ends with a query that shows the result. Nothing here
deletes a document, a file or an athlete.

Run a file in the Supabase SQL editor for project `emllcefqxyxyhqolrllo`,
or through the builder's Supabase tool, never against any other project.

| File | Decision | What it changes |
|---|---|---|
| `1_admin_swap.sql` | Admin account | Adds dave@bffsa.org to Bridge as Admin, then takes davefisher813@gmail.com off Bridge. Elite Squad is not touched. |
| `2_documents.sql` | Files | Moves the 16 prepared files from Archived to Needs Review and the 17 Oct 9 copies from Needs Review to Archived. Two lifecycle moves the database allows. Writes one activity row per move. |
| `3_athletes.sql` | Athletes | Adds Ricky Perez and Frailyn Capellan to Bridge as Active baseball athletes, name only. |
| `4_bucket_limit.sql` | File size limit | Sets the documents bucket limit back to 10 MB, matching the app. |

Done in the app, not in SQL:

- **Henry Tolentino:** an Admin of Elite Squad opens Members, Invite, enters his email, picks Admin or Viewer, then sets his Title to "Asst Coach" on his row. Sending an invitation needs the auth service, which SQL cannot reach.
- **Backups:** Supabase dashboard, project Bridge-app, Database, Backups. Confirm daily backups. Turn on point in time recovery if the plan allows it.
- **Migration 0047 (View As):** cut. Not applied, not merged, nothing to run.
