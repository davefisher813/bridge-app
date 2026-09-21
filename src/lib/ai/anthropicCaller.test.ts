import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { contentFor, costCents, createAnthropicCaller, ModelRefusedError, type MessagesClient, type ModelUsage } from "./anthropicCaller";
import type { ModelCallOptions } from "@/lib/docai/pipeline";
import type { IngestedRecord } from "@/lib/docai/types";

const record = (over: Partial<IngestedRecord>): IngestedRecord => ({
  originalName: "scan.pdf",
  originalSize: 1000,
  originalMime: "application/pdf",
  kind: "pdf",
  sourceRole: "coordinator",
  ingestedAt: "2026-09-21T00:00:00.000Z",
  requestId: "req_1",
  mediaType: "application/pdf",
  base64: "JVBERi0=",
  blockType: "document",
  ...over,
});

const call = (over: Partial<ModelCallOptions> = {}): ModelCallOptions => ({
  model: "claude-opus-5",
  maxTokens: 2000,
  system: "Return only JSON.",
  userText: "Read this transcript.",
  records: [record({})],
  requestId: "req_1_extract",
  ...over,
});

function fakeClient(reply: Partial<Anthropic.Message>, seen: Anthropic.MessageCreateParamsNonStreaming[] = []): MessagesClient {
  return {
    messages: {
      async create(params) {
        seen.push(params);
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "text", text: "{\"ok\":true}", citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, speed: null, iterations: null },
          ...reply,
        } as Anthropic.Message;
      },
    },
  };
}

describe("the real model caller", () => {
  it("sends a PDF as a document block and an image as an image block, then the prompt", () => {
    const blocks = contentFor(call({ records: [record({}), record({ originalName: "page.jpg", kind: "image", mediaType: "image/jpeg", blockType: "image", base64: "/9j/" })] }));
    expect(blocks.map((b) => b.type)).toEqual(["document", "image", "text"]);
  });

  it("names a file it cannot attach instead of dropping it silently", () => {
    const blocks = contentFor(call({ records: [record({}), record({ originalName: "photo.heic", kind: "heic", mediaType: "image/heic", blockType: "image", fallbackReason: "HEIC cannot be decoded here" })] }));
    const text = blocks.find((b) => b.type === "text") as { text: string };
    expect(blocks).toHaveLength(2);
    expect(text.text).toMatch(/photo\.heic \(HEIC cannot be decoded here\)/);
  });

  it("refuses to call with nothing the model can read", async () => {
    const caller = createAnthropicCaller({ client: fakeClient({}) });
    await expect(caller(call({ records: [record({ kind: "unknown", mediaType: "application/octet-stream", blockType: "document" })] }))).rejects.toThrow(/None of the files/);
  });

  it("returns the text, reports the usage with its cost, and never lowballs max_tokens", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const usages: ModelUsage[] = [];
    const caller = createAnthropicCaller({ client: fakeClient({}, seen), onUsage: (u) => void usages.push(u) });
    const text = await caller(call());
    expect(text).toBe("{\"ok\":true}");
    expect(seen[0]!.max_tokens).toBeGreaterThanOrEqual(16000);
    expect(seen[0]!.system).toBe("Return only JSON.");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ requestId: "req_1_extract", model: "claude-opus-5", inputTokens: 1200, outputTokens: 300 });
    // 1200 in at $5/M plus 300 out at $25/M is $0.0135, which is 1.35 cents.
    expect(usages[0]!.costCents).toBe(1.35);
  });

  it("a refusal is an error, and it is still charged", async () => {
    const usages: ModelUsage[] = [];
    const caller = createAnthropicCaller({
      client: fakeClient({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "not a document" } as Anthropic.Message["stop_details"], content: [] }),
      onUsage: (u) => void usages.push(u),
    });
    await expect(caller(call())).rejects.toThrow(ModelRefusedError);
    expect(usages).toHaveLength(1);
  });

  it("an answer cut off at max_tokens is an error rather than half a JSON object", async () => {
    const caller = createAnthropicCaller({ client: fakeClient({ stop_reason: "max_tokens" }) });
    await expect(caller(call())).rejects.toThrow(/cut off/);
  });

  it("prices a dated snapshot id by its alias, and the cost is on the model that was asked for", async () => {
    expect(costCents("claude-sonnet-5-20260601", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(200);
    expect(costCents("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(100);
    const usages: ModelUsage[] = [];
    const caller = createAnthropicCaller({ client: fakeClient({ model: "claude-haiku-4-5-20251001" }), onUsage: (u) => void usages.push(u) });
    await caller(call({ model: "claude-haiku-4-5" }));
    expect(usages[0]!.model).toBe("claude-haiku-4-5-20251001");
    // 1200 in at $1/M plus 300 out at $5/M: 0.27 cents, the Haiku rate.
    expect(usages[0]!.costCents).toBe(0.27);
  });

  it("prices cache reads and writes, and an unknown model at the Opus rate", () => {
    expect(costCents("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(100);
    expect(costCents("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBe(50);
    expect(costCents("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(625);
    expect(costCents("some-future-model", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(500);
  });
});
