import { describe, expect, it } from "vitest";
import { checkVaultFile, extensionOf, safeStorageName, sniffBytes, VAULT_ACCEPT, VAULT_FORMATS_SENTENCE, VAULT_MAX_BYTES, VAULT_MEDIA_TYPES, zipEntryNames } from "./format";
import { GOOD_NAMES, makeFile, makeZip } from "@/testing/vaultFiles";

describe("the seven formats are accepted from their real bytes", () => {
  const cases: Array<[keyof typeof GOOD_NAMES, string, string]> = [
    ["pdf", "pdf", "application/pdf"],
    ["docx", "word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["doc", "word", "application/msword"],
    ["xlsx", "excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["xls", "excel", "application/vnd.ms-excel"],
    ["csv", "csv", "text/csv"],
    ["jpg", "jpg", "image/jpeg"],
    ["png", "png", "image/png"],
    ["txt", "txt", "text/plain"],
  ];
  for (const [kind, format, mediaType] of cases) {
    it(`${kind}: ${format}, ${mediaType}`, () => {
      const r = checkVaultFile(GOOD_NAMES[kind], makeFile(kind));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.format).toBe(format);
        expect(r.mediaType).toBe(mediaType);
      }
    });
  }

  it("a .jpeg name is a JPG", () => {
    const r = checkVaultFile("Photo.JPEG", makeFile("jpg"));
    expect(r.ok && r.format).toBe("jpg");
  });

  it("every accepted media type is one the bucket lists, and nothing else is", () => {
    const produced = new Set(Object.values(GOOD_NAMES).map((n) => (checkVaultFile(n, makeFile((n.split(".").pop() as keyof typeof GOOD_NAMES))) as { mediaType: string }).mediaType));
    expect([...produced].sort()).toEqual([...VAULT_MEDIA_TYPES].sort());
  });

  it("a PDF with junk before its header still counts", () => {
    const body = makeFile("pdf");
    const withJunk = new Uint8Array([...new Array(200).fill(0x0a), ...body]);
    expect(checkVaultFile("scan.pdf", withJunk).ok).toBe(true);
  });

  it("a Windows-1252 CSV (bytes above 0x7f, not UTF-8) is still text", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("name,city\nJos"), 0xe9, ...new TextEncoder().encode(",Stamford\n")]);
    expect(checkVaultFile("list.csv", bytes).ok).toBe(true);
  });
});

describe("the picker and the bucket list the same nine extensions and types", () => {
  it("accept names the nine extensions and not HEIC, GIF or WebP", () => {
    const list = VAULT_ACCEPT.split(",");
    expect(list.sort()).toEqual([".csv", ".doc", ".docx", ".jpeg", ".jpg", ".pdf", ".png", ".txt", ".xls", ".xlsx"].sort());
    expect(VAULT_ACCEPT).not.toMatch(/heic|gif|webp/);
  });
});

describe("refusals are plain, name the seven, and never rest on the browser's word", () => {
  const refusal = (name: string, bytes: Uint8Array) => {
    const r = checkVaultFile(name, bytes);
    expect(r.ok).toBe(false);
    return r as Extract<ReturnType<typeof checkVaultFile>, { ok: false }>;
  };

  it("a format outside the seven names the seven", () => {
    const r = refusal("slides.pptx", makeZip({ "ppt/presentation.xml": "x" }));
    expect(r.code).toBe("not_accepted");
    expect(r.reason).toContain(VAULT_FORMATS_SENTENCE);
  });

  it("GIF, WebP and HEIC are refused by name, whatever the bytes", () => {
    for (const [name, kind] of [["a.gif", "gif"], ["a.webp", "webp"], ["a.heic", "heic"]] as const) {
      expect(refusal(name, makeFile(kind)).code).toBe("not_accepted");
    }
  });

  it("a file with no extension is refused", () => {
    expect(refusal("README", makeFile("txt")).code).toBe("not_accepted");
  });

  it("the extension and the bytes must agree: a PNG named .jpg", () => {
    const r = refusal("photo.jpg", makeFile("png"));
    expect(r.code).toBe("mismatch");
    expect(r.reason).toMatch(/contents are a PNG image, not \.jpg/);
    expect(r.reason).toContain(VAULT_FORMATS_SENTENCE);
  });

  it("a text file named .pdf is refused", () => {
    expect(refusal("fake.pdf", makeFile("txt")).code).toBe("mismatch");
  });

  it("a plain zip named .docx or .xlsx is refused, and a docx named .xlsx too", () => {
    expect(refusal("a.docx", makeFile("zip")).code).toBe("mismatch");
    expect(refusal("a.xlsx", makeFile("zip")).code).toBe("mismatch");
    expect(refusal("a.xlsx", makeFile("docx")).code).toBe("mismatch");
    expect(refusal("a.docx", makeFile("xlsx")).code).toBe("mismatch");
  });

  it("binary bytes named .txt or .csv are refused", () => {
    expect(refusal("a.txt", makeFile("binary")).code).toBe("mismatch");
    expect(refusal("a.csv", makeFile("binary")).code).toBe("mismatch");
  });

  it("an old Office file renamed .pdf is refused", () => {
    expect(refusal("a.pdf", makeFile("doc")).code).toBe("mismatch");
  });

  it("an empty file is refused as empty", () => {
    expect(refusal("a.pdf", makeFile("empty")).code).toBe("empty");
  });

  it("over 10 MB is refused with the size and the limit", () => {
    const big = new Uint8Array(VAULT_MAX_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46]);
    const r = refusal("big.pdf", big);
    expect(r.code).toBe("too_big");
    expect(r.reason).toMatch(/10\.0 MB\. The limit is 10 MB\./);
  });

  it("exactly 10 MB is accepted", () => {
    const edge = new Uint8Array(VAULT_MAX_BYTES);
    edge.set([0x25, 0x50, 0x44, 0x46]);
    expect(checkVaultFile("edge.pdf", edge).ok).toBe(true);
  });

  it("no refusal uses an em dash", () => {
    const messages = [refusal("a.gif", makeFile("gif")).reason, refusal("a.jpg", makeFile("png")).reason, refusal("a.pdf", makeFile("empty")).reason];
    for (const m of messages) expect(m).not.toContain("\u2014");
  });
});

describe("helpers", () => {
  it("extensionOf reads the last extension, case-insensitively, and ignores folders", () => {
    expect(extensionOf("Report.Final.PDF")).toBe("pdf");
    expect(extensionOf("C:\\files\\a.docx")).toBe("docx");
    expect(extensionOf("noext")).toBe("");
  });

  it("sniffBytes tells the kinds apart", () => {
    expect(sniffBytes(makeFile("pdf"))).toBe("pdf");
    expect(sniffBytes(makeFile("jpg"))).toBe("jpg");
    expect(sniffBytes(makeFile("png"))).toBe("png");
    expect(sniffBytes(makeFile("zip"))).toBe("zip");
    expect(sniffBytes(makeFile("doc"))).toBe("ole2");
    expect(sniffBytes(makeFile("txt"))).toBe("text");
    expect(sniffBytes(makeFile("binary"))).toBe("unknown");
  });

  it("zipEntryNames lists names from the central directory and survives garbage", () => {
    expect(zipEntryNames(makeFile("docx"))).toContain("word/document.xml");
    expect(zipEntryNames(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it("safeStorageName keeps a name safe as the end of a path", () => {
    expect(safeStorageName("../../Mom's Letter (1).pdf")).toBe("Mom_s_Letter_1_.pdf");
    expect(safeStorageName("....")).toBe("file");
    expect(safeStorageName("a".repeat(200)).length).toBe(80);
  });
});

describe("sizes and labels read the way a person says them", () => {
  it("formatBytes", async () => {
    const { formatBytes } = await import("./format");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(48213)).toBe("47 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(-1)).toBe("");
  });
  it("formatLabelOf prefers the stored format and falls back on the media type", async () => {
    const { formatLabelOf } = await import("./format");
    expect(formatLabelOf("word", null)).toBe("Word");
    expect(formatLabelOf(null, "image/png")).toBe("PNG");
    expect(formatLabelOf(null, "image/gif")).toBe("File");
  });
});
