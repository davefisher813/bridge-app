// The small pieces every action test repeats: turning an action's two
// ways of finishing (a returned state, or a thrown redirect) into one
// shape, building a FormData, and picking an org out of a dataset.
//
// The vi.mock calls cannot live here (vitest hoists them per test file),
// so each test file mocks next/* and the Supabase clients itself, the
// same way src/laws/actionRun.test.ts does. What is here has no mocks.

import type { Dataset, RecordedWrite } from "@/testing/fakeSupabase";

export const NOT_FOUND = "NEXT_NOT_FOUND";
export const REDIRECT = "NEXT_REDIRECT:";

// Actions redirect on success, which throws in Next. This turns both
// endings into one shape to assert on.
export async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    const state = await fn();
    return { redirect: null, state };
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith(REDIRECT)) return { redirect: message.slice(REDIRECT.length), state: null };
    throw e;
  }
}

export function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

export const orgIdBySlug = (data: Dataset, slug: string): string => data.orgs!.find((o) => o.slug === slug)!.id as string;

export const writesTo = (writes: RecordedWrite[], table: string, op?: RecordedWrite["op"]) => writes.filter((w) => w.table === table && (!op || w.op === op));

// The filter columns an update or delete ran with, so a law can say the
// write was scoped by id AND org, not just one of them.
export const filterColumns = (w: RecordedWrite | undefined): string[] => (w?.filters ?? []).map((f) => f.column).sort();

// The errors object a rejected action returns.
export const errorsOf = (state: unknown): Record<string, string> => (state as { errors: Record<string, string> }).errors;
