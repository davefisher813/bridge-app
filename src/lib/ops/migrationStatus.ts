import { titleCase } from "@/lib/copy/titleCase";
import type { LedgerRow } from "./appliedLedger";

// Organization Settings, Database Updates: the repo's ledger
// (migrations/APPLIED.md) checked against the database's own history
// (migration 0057). Pure, so a law can hand it both lists.

export type MigrationState = "on_database" | "by_hand" | "missing" | "pending" | "cut";

export interface MigrationLine {
  file: string;
  title: string;
  state: MigrationState;
}

export interface MigrationStatus {
  // False when the database answered nothing (the history could not be
  // read); the lines then only say what the ledger says.
  checked: boolean;
  lines: MigrationLine[];
  applied: number;
  missing: MigrationLine[];
  pending: MigrationLine[];
  latest: MigrationLine | null;
}

export const STATE_LABEL: Record<MigrationState, string> = {
  on_database: "On the Database",
  by_hand: "Applied by Hand",
  missing: "Missing on the Database",
  pending: "Not Applied Yet",
  cut: "Never to Be Applied",
};

export function migrationTitle(file: string): string {
  // The name a person reads, without the file's number (Alfred,
  // 2026-10-15: "0074 View As" read as developer language).
  const [, ...rest] = file.split("_");
  return titleCase(rest.join(" "));
}

export function migrationStatus(ledger: LedgerRow[], history: { version: string }[] | null): MigrationStatus {
  const versions = new Set((history ?? []).map((h) => String(h.version)));
  const checked = versions.size > 0;
  const lines = ledger.map((row): MigrationLine => {
    const title = migrationTitle(row.file);
    if (row.recorded === "cut") return { file: row.file, title, state: "cut" };
    if (row.recorded === "pending") {
      // Applied since the ledger was written: the database says so.
      return { file: row.file, title, state: checked && history!.some((h) => (h as { name?: string }).name === row.file) ? "on_database" : "pending" };
    }
    if (row.versions.length === 0) return { file: row.file, title, state: "by_hand" };
    if (!checked) return { file: row.file, title, state: "on_database" };
    return { file: row.file, title, state: row.versions.every((v) => versions.has(v)) ? "on_database" : "missing" };
  });
  const applied = lines.filter((l) => l.state === "on_database" || l.state === "by_hand");
  return {
    checked,
    lines,
    applied: applied.length,
    missing: lines.filter((l) => l.state === "missing"),
    pending: lines.filter((l) => l.state === "pending"),
    latest: applied[applied.length - 1] ?? null,
  };
}
