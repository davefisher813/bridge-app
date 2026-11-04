import { describe, expect, it, vi } from "vitest";
import { loadLockedDocuments, lockedDocumentById, LOCKED_OPENERS, LOCKED_TITLE } from "./lockedDocuments";
import { isMissingFunction, linkDocument } from "./linkDocument";

const stub = { id: "d1", status: "pending", lifecycle: "needs_review", created_at: "2026-11-01T00:00:00Z" };

describe("locked documents (0078)", () => {
  it("asks the database once and returns the stubs", async () => {
    const rpc = vi.fn(async () => ({ data: [stub], error: null }));
    expect(await loadLockedDocuments({ rpc } as never, "org1")).toEqual([stub]);
    expect(rpc).toHaveBeenCalledWith("documents_locked", { p_org: "org1" });
  });

  it("answers with nothing before 0078 is on the database, on any error, and on a throw", async () => {
    expect(await loadLockedDocuments({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) } as never, "o")).toEqual([]);
    expect(await loadLockedDocuments({ rpc: async () => ({ data: "oops", error: null }) } as never, "o")).toEqual([]);
    expect(await loadLockedDocuments({ rpc: async () => { throw new Error("down"); } } as never, "o")).toEqual([]);
  });

  it("finds one by id", async () => {
    const client = { rpc: async () => ({ data: [stub], error: null }) } as never;
    expect(await lockedDocumentById(client, "o", "d1")).toEqual(stub);
    expect(await lockedDocumentById(client, "o", "nope")).toBeNull();
  });

  it("names who can open one by role, never by person", () => {
    expect(LOCKED_TITLE).toBe("Locked Document");
    expect(LOCKED_OPENERS).toBe("the athlete it belongs to, that athlete's advisor and the Master Account");
  });
});

function fakeUpdate(result: { data: unknown; error: unknown }) {
  const chain: any = { update: vi.fn(() => chain), eq: vi.fn(() => chain), select: vi.fn(async () => result) };
  return { from: vi.fn(() => chain), chain };
}

describe("linking a document (0078)", () => {
  it("an unlinked document goes through document_link_athlete", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc, from: vi.fn() } as never;
    expect(await linkDocument(client, { orgId: "o", documentId: "d", currentAthleteId: null, athleteId: "a" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("document_link_athlete", { p_doc: "d", p_athlete: "a" });
  });

  it("falls back to the plain update only when the function is not there yet", async () => {
    const upd = fakeUpdate({ data: [{ id: "d" }], error: null });
    const client = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "not found" } }), from: upd.from } as never;
    expect(await linkDocument(client, { orgId: "o", documentId: "d", currentAthleteId: null, athleteId: "a" })).toEqual({ ok: true });
    expect(upd.chain.update).toHaveBeenCalled();
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
  });

  it("does not fall back when the database refuses: locked, or already has an athlete", async () => {
    const from = vi.fn();
    const locked = { rpc: async () => ({ data: null, error: { code: "42501", message: "document_link_athlete: this document is locked" } }), from } as never;
    expect(await linkDocument(locked, { orgId: "o", documentId: "d", currentAthleteId: null, athleteId: "a" })).toEqual({ ok: false, reason: "locked" });
    const has = { rpc: async () => ({ data: null, error: { code: "42501", message: "document_link_athlete: this document already belongs to an athlete" } }), from } as never;
    expect(await linkDocument(has, { orgId: "o", documentId: "d", currentAthleteId: null, athleteId: "a" })).toEqual({ ok: false, reason: "has_athlete" });
    expect(from).not.toHaveBeenCalled();
  });

  it("moving or clearing a linked document is a plain update that the database allows or refuses", async () => {
    const rpc = vi.fn();
    const ok = fakeUpdate({ data: [{ id: "d" }], error: null });
    expect(await linkDocument({ rpc, from: ok.from } as never, { orgId: "o", documentId: "d", currentAthleteId: "a1", athleteId: "a2" })).toEqual({ ok: true });
    const refused = fakeUpdate({ data: null, error: { code: "42501", message: "rls" } });
    expect(await linkDocument({ rpc, from: refused.from } as never, { orgId: "o", documentId: "d", currentAthleteId: "a1", athleteId: null })).toEqual({ ok: false, reason: "has_athlete" });
    const none = fakeUpdate({ data: [], error: null });
    expect(await linkDocument({ rpc, from: none.from } as never, { orgId: "o", documentId: "d", currentAthleteId: "a1", athleteId: "a2" })).toEqual({ ok: false, reason: "locked" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
