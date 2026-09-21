// The real ModelCaller: the one thing src/lib/docai never knew about.
//
// The pipeline in src/lib/docai/pipeline.ts takes a function that turns
// a system prompt, a user prompt and the ingested files into the model's
// text. Until 2026-09-21 the only implementation was the stub. This one
// calls the Anthropic API through the official SDK, hands the files over
// as document and image blocks, reports what the call cost to whoever
// keeps the ledger, and turns a refusal or an empty answer into an error
// the pipeline already knows how to file as a failed extraction.
//
// Kept out of src/lib/docai on purpose (CLAUDE.md, the walled-off rule):
// that module stays free of the SDK, the environment and the network so
// it can run in the test bench and under vitest with a scripted model.

import Anthropic from "@anthropic-ai/sdk";
import type { ModelCallOptions, ModelCaller } from "@/lib/docai/pipeline";

export interface ModelUsage {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number;
}

// List price per million tokens, Anthropic first-party rates as of
// 2026-06. A model not in the table is charged at the Opus rate, which
// errs on the side of the budget running out early rather than late.
export const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

// Cache reads are a tenth of the input rate and cache writes a quarter
// over it. Rounded to a thousandth of a cent, which is what the ledger
// column holds.
export function costCents(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  const price = PRICE_PER_MILLION[model] ?? PRICE_PER_MILLION["claude-opus-5"]!;
  const dollars =
    (usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.input * 0.1 + usage.cacheWriteTokens * price.input * 1.25) / 1_000_000;
  return Math.round(dollars * 100 * 1000) / 1000;
}

export class ModelRefusedError extends Error {
  constructor(explanation?: string | null) {
    super(explanation ? `The model declined to read this document: ${explanation}` : "The model declined to read this document.");
    this.name = "ModelRefusedError";
  }
}

// The slice of the SDK client this file uses, so a test can hand in a
// fake without the network.
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Every file the browser ingested, as the block the API takes for it. A
// file the model cannot read (a HEIC, an unknown type) is named in the
// prompt rather than dropped in silence, so the model can say so.
export function contentFor(opts: ModelCallOptions): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const unreadable: string[] = [];
  for (const r of opts.records) {
    if (r.blockType === "document" && r.mediaType === "application/pdf" && r.base64) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: r.base64 } });
    } else if (r.blockType === "image" && IMAGE_TYPES.has(r.mediaType) && r.base64) {
      blocks.push({ type: "image", source: { type: "base64", media_type: r.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: r.base64 } });
    } else {
      unreadable.push(`${r.originalName}${r.fallbackReason ? ` (${r.fallbackReason})` : ""}`);
    }
  }
  const note = unreadable.length ? `\n\nFiles that could not be attached: ${unreadable.join("; ")}.` : "";
  blocks.push({ type: "text", text: `${opts.userText}${note}` });
  return blocks;
}

export interface AnthropicCallerOptions {
  client?: MessagesClient;
  // Called once per completed call with what the API reported. The
  // action that owns the document writes it to the ledger.
  onUsage?: (usage: ModelUsage) => Promise<void> | void;
}

export function createAnthropicCaller(opts: AnthropicCallerOptions = {}): ModelCaller {
  const client: MessagesClient = opts.client ?? new Anthropic();
  return async (call) => {
    const content = contentFor(call);
    if (content.length === 1) throw new Error("None of the files can be read by the model.");

    const response = await client.messages.create({
      model: call.model,
      // The pipeline asks for a few hundred to a few thousand tokens of
      // JSON. Thinking on the current models counts against the same
      // ceiling, so the floor is high enough that an answer is never
      // cut off mid-brace.
      max_tokens: Math.max(call.maxTokens, 16000),
      system: call.system,
      messages: [{ role: "user", content }],
    });

    const usage: ModelUsage = {
      requestId: call.requestId,
      model: response.model || call.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      costCents: 0,
    };
    usage.costCents = costCents(usage.model, usage);
    if (opts.onUsage) await opts.onUsage(usage);

    if (response.stop_reason === "refusal") {
      throw new ModelRefusedError(response.stop_details?.explanation ?? null);
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error(`The model returned no text (stop reason ${response.stop_reason ?? "unknown"}).`);
    if (response.stop_reason === "max_tokens") throw new Error("The model's answer was cut off before it finished.");
    return text;
  };
}
