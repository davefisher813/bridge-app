import { describe, expect, it, vi } from "vitest";
import { downloadAfterUpload, type BucketClient, type DownloadResult } from "./readBack";

const blob = new Blob(["pdf"]);
const refused: DownloadResult = { data: null, error: { message: "Object not found" } };
const ok: DownloadResult = { data: blob, error: null };

function bucket(result: DownloadResult) {
  const download = vi.fn(async () => result);
  const client: BucketClient = { storage: { from: () => ({ download }) } };
  return { client, download };
}

describe("reading a file straight after upload (0078)", () => {
  it("uses the person's own read when Storage allows it, and asks nothing else", async () => {
    const user = bucket(ok);
    const rpc = vi.fn();
    const admin = vi.fn();
    const got = await downloadAfterUpload({ ...user.client, rpc }, admin, "org/doc_1/a.pdf");
    expect(got).toBe(ok);
    expect(rpc).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
  });

  it("falls back to the service client only when the database says it is the person's own unlisted upload", async () => {
    const user = bucket(refused);
    const svc = bucket(ok);
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const got = await downloadAfterUpload({ ...user.client, rpc }, () => svc.client, "org/doc_1/a.pdf");
    expect(got).toBe(ok);
    expect(rpc).toHaveBeenCalledWith("upload_is_mine", { p_path: "org/doc_1/a.pdf" });
    expect(svc.download).toHaveBeenCalledWith("org/doc_1/a.pdf");
  });

  it("keeps the refusal when the object is not the person's own unlisted upload", async () => {
    const user = bucket(refused);
    const admin = vi.fn();
    for (const reply of [{ data: false, error: null }, { data: null, error: { message: "x" } }, { data: "true", error: null }]) {
      const got = await downloadAfterUpload({ ...user.client, rpc: async () => reply }, admin, "org/doc_1/a.pdf");
      expect(got).toBe(refused);
    }
    expect(admin).not.toHaveBeenCalled();
  });

  it("keeps the refusal when the question itself fails or the service client cannot be made", async () => {
    const user = bucket(refused);
    const thrown = await downloadAfterUpload({ ...user.client, rpc: async () => { throw new Error("down"); } }, vi.fn(), "org/doc_1/a.pdf");
    expect(thrown).toBe(refused);
    const noAdmin = await downloadAfterUpload(
      { ...user.client, rpc: async () => ({ data: true, error: null }) },
      () => { throw new Error("no service key"); },
      "org/doc_1/a.pdf"
    );
    expect(noAdmin).toBe(refused);
  });

  it("keeps the refusal when the client cannot ask", async () => {
    const user = bucket(refused);
    expect(await downloadAfterUpload(user.client, vi.fn(), "org/doc_1/a.pdf")).toBe(refused);
  });
});
