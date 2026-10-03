// The model caller, replaced for FIXTURE_MODE builds: the stub, with the
// usage report a real call would make. Aliased over
// @/lib/ai/anthropicCaller by next.config.ts, so a fixture build can
// never reach the Anthropic API whatever the environment holds: there is
// no SDK in the bundle and no network call in the code. The browser
// tests (e2e/) set a placeholder ANTHROPIC_API_KEY so the app takes the
// "a model is connected" path, and this is what answers.
//
// The stub's reading quality is decided by the file's name and size, the
// same seed the app gives it when no key is set (readAndFile in
// src/lib/actions/documents.ts), so a test picks the outcome it wants by
// choosing the file: e2e/support/files.ts holds the ones that read clean.
//
// The usage numbers are fixed and fake; they exist so the ledger and the
// month's cap have rows to count, the same as the vitest mock in
// src/laws/actionRun.test.ts.

import { createStubCaller } from "@/lib/docai/stubCaller";
import type { ModelCallOptions } from "@/lib/docai/pipeline";

export function createAnthropicCaller(opts: { onUsage?: (u: unknown) => Promise<void> | void } = {}) {
  return async (call: ModelCallOptions) => {
    const first = call.records[0];
    const seedText = first ? `${first.originalName}:${first.originalSize}` : "fixture-model";
    if (opts.onUsage) await opts.onUsage({ requestId: call.requestId, model: call.model, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costCents: 1.35 });
    return createStubCaller({ category: "transcript", seedText })(call);
  };
}
