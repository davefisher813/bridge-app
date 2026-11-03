// Who may open a file (Dave, 2026-11-03: "the real user decides files").
// Migration 0078 keys every file read to the real signed-in person, never to
// the person being viewed, masks the rest as a locked row, and keeps the
// post-upload read-back honest. These read the migration and the app; the
// behavior itself is proved by scripts/proof/0078_proofs.sql.
//
// Verified these laws bite: put private._effective_uid() into
// _can_read_document_object, turned the AND in _real_can_read_doc into an OR,
// and removed the _viewing() refusal from document_link_athlete, watched each
// fail, reverted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/0078_files_follow_the_real_user.sql", "utf8").replace(/--[^\n]*/g, "");

// The text of one function (from its create line to its closing $$;).
function fn(name: string): string {
  const start = sql.indexOf(`function ${name}(`);
  expect(start, `${name} is defined in 0078`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

describe("LAW: a file opens for the real user, never the person being viewed", () => {
  it("the storage read answers for auth.uid() in every branch", () => {
    const body = fn("private._can_read_document_object");
    expect(body).toMatch(/auth\.uid\(\)/);
    for (const viewed of ["_effective_uid", "_view_org", "_view_target", "_family_athlete_ids", "_member_org_ids", "_staff_org_ids"]) {
      expect(body, `${viewed} follows the person being viewed`).not.toContain(viewed);
    }
  });

  it("the real-user helpers read auth.uid() and never the viewed identity", () => {
    for (const name of ["private._real_staff_org_ids", "private._real_entitled_to_athlete"]) {
      const body = fn(name);
      expect(body).toMatch(/auth\.uid\(\)/);
      expect(body).not.toMatch(/_effective_uid|_view_org|_view_target/);
    }
  });

  it("a document that names several athletes opens only for someone entitled to every one", () => {
    const body = fn("private._real_can_read_doc");
    expect(body).toMatch(/\(p_a is null or private\._real_entitled_to_athlete\(p_a, p_org\)\)\s+and \(p_l is null or private\._real_entitled_to_athlete\(p_l, p_org\)\)\s+and \(p_s is null or private\._real_entitled_to_athlete\(p_s, p_org\)\)/);
  });

  it("the table read is the screen's rule AND the real user's right", () => {
    expect(sql).toMatch(/create policy documents_read on public\.documents for select\s+using \(\s*org_id in \(select private\._member_org_ids\(\)\)\s+and private\._real_can_read_doc\(org_id, athlete_id, linked_athlete_id, subject_athlete_id\)\s*\)/);
  });

  it("a file is looked up by both storage_paths and original_paths", () => {
    const body = fn("private._can_read_document_object");
    expect(body).toMatch(/obj = any \(d\.storage_paths\) or obj = any \(d\.original_paths\)/);
  });
});

describe("LAW: a locked row shows state and date and nothing else", () => {
  it("documents_locked returns exactly id, org_id, status, lifecycle and created_at", () => {
    const body = fn("public.documents_locked");
    expect(body).toMatch(/returns table \(id uuid, org_id uuid, status text, lifecycle text, created_at timestamptz\)/);
    // What it selects, as opposed to what it filters on.
    const selected = body.slice(body.indexOf("select d.id"), body.indexOf("from public.documents d")).replace(/\s+/g, " ").trim();
    expect(selected).toBe("select d.id, d.org_id, d.status::text, d.lifecycle::text, d.created_at");
  });

  it("is granted to signed-in people only", () => {
    expect(sql).toMatch(/revoke all on function public\.documents_locked\(uuid\) from public, anon;\s+grant execute on function public\.documents_locked\(uuid\) to authenticated;/);
  });
});

describe("LAW: the only unentitled write is linking an unlinked document, and view-as never writes", () => {
  it("document_link_athlete refuses while viewing, refuses a locked document, and never changes an athlete", () => {
    const body = fn("public.document_link_athlete");
    expect(body).toMatch(/private\._viewing\(\)/);
    expect(body).toMatch(/private\._real_can_read_doc\(/);
    expect(body).toMatch(/already belongs to an athlete/);
    expect(body).toMatch(/p_athlete is null\s+or \(d\.athlete_id is not null and d\.athlete_id <> p_athlete\)/);
  });

  it("upload_is_mine refuses while viewing and needs the caller's own upload that no document lists", () => {
    const body = fn("public.upload_is_mine");
    expect(body).toMatch(/not private\._viewing\(\)/);
    expect(body).toMatch(/o\.owner = auth\.uid\(\) or o\.owner_id = auth\.uid\(\)::text/);
    expect(body).toMatch(/not exists \(select 1 from public\.documents d where p_path = any \(d\.storage_paths\) or p_path = any \(d\.original_paths\)\)/);
  });

  it("a new row may list only an object its caller uploaded (owner or owner_id), in its own org folder, never one another document lists", () => {
    const body = fn("private.documents_insert_guard");
    expect(body).toMatch(/o\.owner = caller or o\.owner_id = caller::text/);
    expect(body).toMatch(/\(storage\.foldername\(p\)\)\[1\] is distinct from new\.org_id::text/);
    expect(body).toMatch(/already belongs to another document/);
  });
});

describe("LAW: the app reads a fresh upload back through the checked path only", () => {
  const documents = readFileSync("src/lib/actions/documents.ts", "utf8");
  const identity = readFileSync("src/lib/actions/documentIdentity.ts", "utf8");

  it("documents.ts reads uploads back with downloadAfterUpload, not the bare client", () => {
    expect(documents).toContain('import { downloadAfterUpload } from "@/lib/vault/readBack";');
    expect(documents).toContain("downloadAfterUpload(supabase, createAdminClient, r.storagePath)");
    expect(documents).toContain("downloadAfterUpload(supabase, createAdminClient, o.storagePath)");
    expect(documents).not.toContain('supabase.storage.from("documents").download(r.storagePath)');
    expect(documents).not.toContain('supabase.storage.from("documents").download(o.storagePath)');
  });

  it("the service client is reached only after the database says the object is the caller's own unlisted upload", () => {
    const helper = readFileSync("src/lib/vault/readBack.ts", "utf8");
    expect(helper.indexOf('rpc("upload_is_mine"')).toBeGreaterThan(-1);
    expect(helper.indexOf("admin()")).toBeGreaterThan(helper.indexOf('rpc("upload_is_mine"'));
  });

  it("a refused identity confirmation says so on the screen", () => {
    expect(identity).toContain("Only this athlete's advisor or the Master Account can change who this document is about.");
    expect(identity).toContain("refusedByAccess(error)");
  });
});
