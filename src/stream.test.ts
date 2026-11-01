import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Citation,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createStreamTransformer, StreamContentAggregator } from "./stream";
import type { GatewayResponse, IncompleteStream } from "./types";

describe("StreamContentAggregator", () => {
	describe("text content", () => {
		it("aggregates text deltas into complete text content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "text-1" });
			aggregator.process({ type: "text-delta", id: "text-1", delta: "Hello " });
			aggregator.process({ type: "text-delta", id: "text-1", delta: "World!" });
			aggregator.process({ type: "text-end", id: "text-1" });
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toEqual([{ type: "text", text: "Hello World!" }]);
		});

		it("handles multiple text blocks", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "text-1" });
			aggregator.process({ type: "text-delta", id: "text-1", delta: "First" });
			aggregator.process({ type: "text-end", id: "text-1" });
			aggregator.process({ type: "text-start", id: "text-2" });
			aggregator.process({ type: "text-delta", id: "text-2", delta: "Second" });
			aggregator.process({ type: "text-end", id: "text-2" });
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(2);
			expect(response.content[0]).toEqual({ type: "text", text: "First" });
			expect(response.content[1]).toEqual({ type: "text", text: "Second" });
		});

		it("keeps deltas for a text id that had no text-start", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-delta", id: "unknown", delta: "kept " });
			aggregator.process({ type: "text-delta", id: "unknown", delta: "anyway" });
			aggregator.process({ type: "reasoning-delta", id: "r-unknown", delta: "also kept" });
			aggregator.process(finishPart);

			expect(aggregator.getResponse().content).toEqual([
				{ type: "text", text: "kept anyway" },
				{ type: "reasoning", text: "also kept" },
			]);
		});
	});

	describe("citations", () => {
		const citation = {
			source: { type: "source", sourceType: "url", id: "s1", url: "https://example.com" },
			startIndex: 0,
			endIndex: 5,
			citedText: "Hello",
		} satisfies LanguageModelV4Citation;

		it("attaches the citations of text-end to the text block", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t" });
			aggregator.process({ type: "text-delta", id: "t", delta: "Hello" });
			aggregator.process({ type: "text-end", id: "t", citations: [citation] });

			expect(aggregator.getResponse().content).toEqual([
				{ type: "text", text: "Hello", citations: [citation] },
			]);
		});

		it("leaves out citations when text-end has none", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t" });
			aggregator.process({ type: "text-end", id: "t" });

			expect(aggregator.getResponse().content).toEqual([{ type: "text", text: "" }]);
		});

		it("attaches citations to the block with the matching id", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "a" });
			aggregator.process({ type: "text-start", id: "b" });
			aggregator.process({ type: "text-end", id: "b", citations: [citation] });
			aggregator.process({ type: "text-end", id: "a" });

			expect(aggregator.getResponse().content).toEqual([
				{ type: "text", text: "" },
				{ type: "text", text: "", citations: [citation] },
			]);
		});

		it("ignores citations on a text-end with no open block", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-end", id: "ghost", citations: [citation] });

			expect(aggregator.getResponse().content).toEqual([]);
		});
	});

	describe("part providerMetadata", () => {
		it("keeps the providerMetadata of text-start on the text block", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t", providerMetadata: { acme: { id: "m1" } } });
			aggregator.process({ type: "text-delta", id: "t", delta: "Hi" });
			aggregator.process({ type: "text-end", id: "t" });

			expect(aggregator.getResponse().content).toStrictEqual([
				{ type: "text", text: "Hi", providerMetadata: { acme: { id: "m1" } } },
			]);
		});

		it("takes the latest providerMetadata a text part carries", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t", providerMetadata: { acme: { n: 1 } } });
			aggregator.process({ type: "text-delta", id: "t", delta: "Hi" });
			aggregator.process({
				type: "text-delta",
				id: "t",
				delta: "!",
				providerMetadata: { acme: { n: 2 } },
			});
			aggregator.process({ type: "text-end", id: "t", providerMetadata: { acme: { n: 3 } } });

			expect(aggregator.getResponse().content).toStrictEqual([
				{ type: "text", text: "Hi!", providerMetadata: { acme: { n: 3 } } },
			]);
		});

		it("keeps a reasoning signature sent on a delta when the end carries none", () => {
			const aggregator = new StreamContentAggregator();
			const signature = { anthropic: { signature: "sig" } };

			aggregator.process({ type: "reasoning-start", id: "r" });
			aggregator.process({ type: "reasoning-delta", id: "r", delta: "Thinking" });
			aggregator.process({
				type: "reasoning-delta",
				id: "r",
				delta: "",
				providerMetadata: signature,
			});
			aggregator.process({ type: "reasoning-end", id: "r" });

			expect(aggregator.getResponse().content).toStrictEqual([
				{ type: "reasoning", text: "Thinking", providerMetadata: signature },
			]);
		});

		it("takes the providerMetadata of reasoning-end", () => {
			const aggregator = new StreamContentAggregator();
			const redacted = { anthropic: { redactedData: "abc" } };

			aggregator.process({ type: "reasoning-start", id: "r" });
			aggregator.process({ type: "reasoning-end", id: "r", providerMetadata: redacted });

			expect(aggregator.getResponse().content).toStrictEqual([
				{ type: "reasoning", text: "", providerMetadata: redacted },
			]);
		});

		it("leaves out providerMetadata when no part carries it", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t" });
			aggregator.process({ type: "text-delta", id: "t", delta: "Hi" });
			aggregator.process({ type: "text-end", id: "t" });
			aggregator.process({ type: "reasoning-delta", id: "r", delta: "Hm" });

			expect(aggregator.getResponse().content).toStrictEqual([
				{ type: "text", text: "Hi" },
				{ type: "reasoning", text: "Hm" },
			]);
		});

		it("ignores providerMetadata on an end with no open block", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-end", id: "ghost", providerMetadata: { acme: {} } });
			aggregator.process({ type: "reasoning-end", id: "ghost", providerMetadata: { acme: {} } });

			expect(aggregator.getResponse().content).toStrictEqual([]);
		});
	});

	describe("reasoning content", () => {
		it("aggregates reasoning deltas into complete reasoning content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "reasoning-start", id: "reason-1" });
			aggregator.process({ type: "reasoning-delta", id: "reason-1", delta: "Let me think... " });
			aggregator.process({ type: "reasoning-delta", id: "reason-1", delta: "I've got it!" });
			aggregator.process({ type: "reasoning-end", id: "reason-1" });
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toEqual([
				{ type: "reasoning", text: "Let me think... I've got it!" },
			]);
		});
	});

	describe("tool calls", () => {
		it("aggregates tool input and captures tool call", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "tool-input-start", id: "tool-1", toolName: "search" });
			aggregator.process({ type: "tool-input-delta", id: "tool-1", delta: '{"query":' });
			aggregator.process({ type: "tool-input-delta", id: "tool-1", delta: '"test"}' });
			aggregator.process({ type: "tool-input-end", id: "tool-1" });
			aggregator.process({
				type: "tool-call",
				toolCallId: "tool-1",
				toolName: "search",
				input: '{"query":"test"}',
			});
			aggregator.process({
				type: "finish",
				finishReason: { unified: "tool-calls", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(1);
			expect(response.content[0]).toMatchObject({
				type: "tool-call",
				toolCallId: "tool-1",
				toolName: "search",
			});
		});

		it("includes tool results in content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "tool-result",
				toolCallId: "tool-1",
				toolName: "search",
				result: { results: ["item1", "item2"] },
			} as LanguageModelV4StreamPart);
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(1);
			expect(response.content[0]).toMatchObject({
				type: "tool-result",
				toolCallId: "tool-1",
			});
		});
	});

	describe("other content types", () => {
		it("includes file content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "file",
				mediaType: "image/png",
				data: { type: "data", data: new Uint8Array([1, 2, 3]) },
			});
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(1);
			expect(response.content[0]).toEqual({
				type: "file",
				mediaType: "image/png",
				data: { type: "data", data: new Uint8Array([1, 2, 3]) },
			});
		});

		it("keeps a file whose data is a URL", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "file",
				mediaType: "image/png",
				data: { type: "url", url: new URL("https://example.com/a.png") },
			});

			expect(aggregator.getResponse().content).toEqual([
				{
					type: "file",
					mediaType: "image/png",
					data: { type: "url", url: new URL("https://example.com/a.png") },
				},
			]);
		});

		it("includes custom content", () => {
			const aggregator = new StreamContentAggregator();
			const part: LanguageModelV4StreamPart = {
				type: "custom",
				kind: "acme.compaction",
				providerMetadata: { acme: { id: "c1" } },
			};

			aggregator.process(part);

			expect(aggregator.getResponse().content).toEqual([part]);
		});

		it("includes reasoning-file content", () => {
			const aggregator = new StreamContentAggregator();
			const part: LanguageModelV4StreamPart = {
				type: "reasoning-file",
				mediaType: "image/png",
				data: { type: "data", data: "AQID" },
			};

			aggregator.process(part);

			expect(aggregator.getResponse().content).toEqual([part]);
		});

		it("keeps custom and reasoning-file parts in arrival order around text", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "t" });
			aggregator.process({ type: "custom", kind: "acme.note" });
			aggregator.process({ type: "text-delta", id: "t", delta: "hi" });
			aggregator.process({
				type: "reasoning-file",
				mediaType: "image/png",
				data: { type: "data", data: "AQID" },
			});
			aggregator.process({ type: "text-end", id: "t" });

			expect(aggregator.getResponse().content.map((part) => part.type)).toEqual([
				"text",
				"custom",
				"reasoning-file",
			]);
		});

		it("includes source content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "source",
				id: "source-1",
				url: "https://example.com",
			} as LanguageModelV4StreamPart);
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(1);
			expect(response.content[0]).toMatchObject({ type: "source" });
		});
	});

	describe("stream-start", () => {
		it("collects warnings from stream-start", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "stream-start",
				warnings: [
					{ type: "other", message: "Warning 1" },
					{ type: "other", message: "Warning 2" },
				],
			});
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.warnings).toHaveLength(2);
			expect(response.warnings[0]).toMatchObject({ message: "Warning 1" });
		});
	});

	describe("response metadata", () => {
		// Off the wire the timestamp is a string, which the part type does not allow.
		function metadataPart(fields: Record<string, unknown>): LanguageModelV4StreamPart {
			return { type: "response-metadata", ...fields } as unknown as LanguageModelV4StreamPart;
		}

		it("records the id, model and timestamp of a response-metadata part", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process(
				metadataPart({
					id: "resp_1",
					modelId: "gpt-5-2025",
					timestamp: "2026-11-01T10:00:00.000Z",
				}),
			);

			expect(aggregator.getResponse().response).toStrictEqual({
				id: "resp_1",
				modelId: "gpt-5-2025",
				timestamp: "2026-11-01T10:00:00.000Z",
			});
		});

		it("keeps earlier fields a later part leaves out and takes the later value of a field it repeats", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process(metadataPart({ id: "resp_1", modelId: "gpt-5" }));
			aggregator.process(
				metadataPart({ modelId: "gpt-5-2025", timestamp: "2026-11-01T10:00:00.000Z" }),
			);

			expect(aggregator.getResponse().response).toStrictEqual({
				id: "resp_1",
				modelId: "gpt-5-2025",
				timestamp: "2026-11-01T10:00:00.000Z",
			});
		});

		it("ignores fields that are not strings", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process(metadataPart({ id: 7, modelId: null, timestamp: {} }));
			aggregator.process(metadataPart({ id: "resp_1" }));

			expect(aggregator.getResponse().response).toStrictEqual({ id: "resp_1" });
		});

		it("leaves out response when no part carries metadata", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process(metadataPart({ id: 7 }));

			expect(aggregator.getResponse()).not.toHaveProperty("response");
		});
	});

	describe("finish event", () => {
		it("captures finish reason and usage", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "finish",
				finishReason: { unified: "length", raw: "max_tokens" },
				usage: {
					inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: undefined },
					outputTokens: { total: 50, text: 40, reasoning: 10 },
				},
				providerMetadata: { custom: { key: "value" } },
			});

			const response = aggregator.getResponse();
			expect(response.finishReason).toEqual({ unified: "length", raw: "max_tokens" });
			expect(response.usage).toEqual({
				inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: undefined },
				outputTokens: { total: 50, text: 40, reasoning: 10 },
			});
			expect(response.providerMetadata).toEqual({ custom: { key: "value" } });
		});

		it("reports an error finish reason after an error part with no finish", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-delta", id: "text-1", delta: "Partial" });
			aggregator.process({ type: "error", error: { message: "provider overloaded" } });

			const response = aggregator.getResponse();
			expect(response.finishReason).toEqual({ unified: "error", raw: undefined });
			expect(response.content).toEqual([{ type: "text", text: "Partial" }]);
			expect(response.usage).toBeUndefined();
		});

		it("keeps the finish reason of a finish part that follows an error part", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "error", error: { message: "tool failed" } });
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: "end_turn" },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			expect(aggregator.getResponse().finishReason).toEqual({ unified: "stop", raw: "end_turn" });
		});

		it("finalizes incomplete text content on finish", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "text-start", id: "text-1" });
			aggregator.process({ type: "text-delta", id: "text-1", delta: "Incomplete" });
			// No text-end before finish
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toEqual([{ type: "text", text: "Incomplete" }]);
		});

		it("finalizes incomplete reasoning content on finish", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "reasoning-start", id: "reason-1" });
			aggregator.process({ type: "reasoning-delta", id: "reason-1", delta: "Thinking..." });
			// No reasoning-end before finish
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toEqual([{ type: "reasoning", text: "Thinking..." }]);
		});
	});

	describe("mixed content", () => {
		it("handles interleaved text and reasoning", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({ type: "reasoning-start", id: "reason-1" });
			aggregator.process({ type: "reasoning-delta", id: "reason-1", delta: "Thinking" });
			aggregator.process({ type: "reasoning-end", id: "reason-1" });
			aggregator.process({ type: "text-start", id: "text-1" });
			aggregator.process({ type: "text-delta", id: "text-1", delta: "Answer" });
			aggregator.process({ type: "text-end", id: "text-1" });
			aggregator.process({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 10,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 5, text: undefined, reasoning: undefined },
				},
			});

			const response = aggregator.getResponse();
			expect(response.content).toHaveLength(2);
			expect(response.content[0]).toEqual({ type: "reasoning", text: "Thinking" });
			expect(response.content[1]).toEqual({ type: "text", text: "Answer" });
		});

		it("keeps blocks in the order they started when a tool call arrives before text-end", () => {
			const aggregator = new StreamContentAggregator();
			const toolCall = {
				type: "tool-call" as const,
				toolCallId: "c1",
				toolName: "lookup",
				input: "{}",
			};

			aggregator.process({ type: "reasoning-start", id: "r1" });
			aggregator.process({ type: "text-start", id: "t1" });
			aggregator.process({ type: "reasoning-delta", id: "r1", delta: "Think" });
			aggregator.process({ type: "text-delta", id: "t1", delta: "Let me " });
			aggregator.process(toolCall);
			aggregator.process({ type: "text-delta", id: "t1", delta: "check" });
			aggregator.process({ type: "text-end", id: "t1" });
			aggregator.process({ type: "reasoning-delta", id: "r1", delta: "ing" });
			aggregator.process({ type: "reasoning-end", id: "r1" });
			aggregator.process({ type: "text-start", id: "t2" });
			aggregator.process({ type: "text-delta", id: "t2", delta: "Done" });
			aggregator.process({ type: "text-end", id: "t2" });
			aggregator.process(finishPart);

			expect(aggregator.getResponse().content).toEqual([
				{ type: "reasoning", text: "Thinking" },
				{ type: "text", text: "Let me check" },
				toolCall,
				{ type: "text", text: "Done" },
			]);
		});
	});
});

const finishPart = {
	type: "finish" as const,
	finishReason: { unified: "stop" as const, raw: undefined },
	usage: {
		inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 0, text: undefined, reasoning: undefined },
	},
};

const encoder = new TextEncoder();
const requestBody = { prompt: [] } as unknown as LanguageModelV4CallOptions;

const usage = {
	inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 5, text: undefined, reasoning: undefined },
};

const finishEvent = {
	type: "finish",
	finishReason: { unified: "stop", raw: "stop" },
	usage,
};

function sse(data: unknown): string {
	return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

function sourceOf(chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	return new Response(stream).text();
}

const passThroughHook = (context: { response: GatewayResponse; incomplete?: IncompleteStream }) =>
	context.response;

describe("createStreamTransformer", () => {
	let consoleWarn: MockInstance<typeof console.warn>;
	let consoleError: MockInstance<typeof console.error>;

	beforeEach(() => {
		consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function loggedText(): string {
		return [...consoleWarn.mock.calls, ...consoleError.mock.calls]
			.flat()
			.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)))
			.join("\n");
	}

	it("passes text events through unchanged", async () => {
		const events = [
			{ type: "text-start", id: "t1" },
			{ type: "text-delta", id: "t1", delta: "Hi" },
			{ type: "text-end", id: "t1" },
		];
		const output = await readAll(
			createStreamTransformer(sourceOf(events.map(sse)), requestBody, passThroughHook),
		);

		expect(output).toBe(events.map(sse).join(""));
	});

	it("passes [DONE] and non-JSON data through", async () => {
		const output = await readAll(
			createStreamTransformer(
				sourceOf([sse("not json"), sse("[DONE]")]),
				requestBody,
				passThroughHook,
			),
		);

		expect(output).toBe("data: not json\n\ndata: [DONE]\n\n");
	});

	it("keeps every line of an event whose data spans several data lines", async () => {
		const json = 'data: {"type":"text-delta",\ndata: "id":"t1","delta":"Hi"}\n\n';
		const text = "data: line one\ndata: line two\n\n";
		const hook = vi.fn(passThroughHook);
		const output = await readAll(
			createStreamTransformer(sourceOf([json, text, sse(finishEvent)]), requestBody, hook),
		);

		expect(output.startsWith(json + text)).toBe(true);
		expect(hook.mock.calls[0]?.[0].response.content).toEqual([{ type: "text", text: "Hi" }]);
	});

	it("replaces the finish event with the hook result", async () => {
		const hook = vi.fn(
			({ response }: { request: LanguageModelV4CallOptions; response: GatewayResponse }) => ({
				...response,
				finishReason: { unified: "length" as const, raw: "max_tokens" },
				usage: { ...usage, outputTokens: { total: 99, text: undefined, reasoning: undefined } },
				providerMetadata: { gateway: { cost: "0.01" } },
			}),
		);
		const output = await readAll(
			createStreamTransformer(
				sourceOf([
					sse({ type: "text-start", id: "t1" }),
					sse({ type: "text-delta", id: "t1", delta: "Hello " }),
					sse({ type: "text-delta", id: "t1", delta: "there" }),
					sse({ type: "text-end", id: "t1" }),
					sse(finishEvent),
				]),
				requestBody,
				hook,
			),
		);

		expect(hook).toHaveBeenCalledOnce();
		expect(hook.mock.calls[0]?.[0].request).toBe(requestBody);
		expect(hook.mock.calls[0]?.[0].response.content).toEqual([
			{ type: "text", text: "Hello there" },
		]);

		const lastEvent = output.trim().split("\n\n").at(-1) ?? "";
		expect(JSON.parse(lastEvent.slice("data: ".length))).toEqual({
			type: "finish",
			finishReason: { unified: "length", raw: "max_tokens" },
			usage: { ...usage, outputTokens: { total: 99 } },
			providerMetadata: { gateway: { cost: "0.01" } },
		});
	});

	it("forwards the original finish event when the hook throws", async () => {
		const output = await readAll(
			createStreamTransformer(
				sourceOf([sse(finishEvent), sse("[DONE]")]),
				requestBody,
				async () => {
					throw new Error("hook failed");
				},
			),
		);

		expect(output).toBe(`${sse(finishEvent)}data: [DONE]\n\n`);
		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleWarn).not.toHaveBeenCalled();
	});

	it.each([undefined, null])(
		"forwards the original finish event when the hook returns %s",
		async (result) => {
			const output = await readAll(
				createStreamTransformer(
					sourceOf([sse(finishEvent), sse("[DONE]")]),
					requestBody,
					// @ts-expect-error the hook type does not allow undefined or null
					async () => result,
				),
			);

			expect(output).toBe(`${sse(finishEvent)}data: [DONE]\n\n`);
			expect(consoleError).toHaveBeenCalledOnce();
		},
	);

	it.each([
		["no finishReason", { finishReason: undefined }, "finishReason must be an object"],
		["a string usage", { usage: "10" }, "usage must be an object or undefined"],
		["an array for providerMetadata", { providerMetadata: [] }, "providerMetadata must be"],
	])(
		"forwards the original finish event and names the problem when the hook returns %s",
		async (_name, override, problem) => {
			const output = await readAll(
				createStreamTransformer(
					sourceOf([sse(finishEvent), sse("[DONE]")]),
					requestBody,
					// @ts-expect-error the overrides break the response type on purpose
					({ response }) => ({ ...response, ...override }),
				),
			);

			expect(output).toBe(`${sse(finishEvent)}data: [DONE]\n\n`);
			expect(consoleError).toHaveBeenCalledOnce();
			expect(consoleError.mock.calls[0]?.[0]).toMatch(
				/^afterResponse hook returned an invalid response, forwarding original finish event: /,
			);
			expect(consoleError.mock.calls[0]?.[0]).toContain(problem);
		},
	);

	it("cancels the source when the output stream is cancelled", async () => {
		const cancel = vi.fn();
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse({ type: "text-start", id: "t1" })));
			},
			cancel,
		});
		const reader = createStreamTransformer(source, requestBody, passThroughHook).getReader();

		await reader.read();
		await reader.cancel("client went away");

		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("client went away"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
	});

	it("reads the upstream only as fast as the client reads", async () => {
		let pulls = 0;
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls++;
				controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "t1", delta: "x" })));
				if (pulls === 200) {
					controller.close();
				}
			},
		});
		const reader = createStreamTransformer(source, requestBody, passThroughHook).getReader();

		await reader.read();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(pulls).toBeLessThan(10);
		await reader.cancel();
	});

	it("logs once and errors the client stream when the upstream body fails mid-stream", async () => {
		const failure = new Error("connection reset");
		let sent = false;
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent) {
					controller.error(failure);
					return;
				}
				sent = true;
				controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "t1", delta: "secret" })));
			},
		});
		const hook = vi.fn(passThroughHook);

		await expect(readAll(createStreamTransformer(source, requestBody, hook))).rejects.toThrow(
			"connection reset",
		);

		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleError.mock.calls[0]?.[0]).toMatch(/^upstream stream failed/);
		expect(consoleError.mock.calls[0]?.[1]).toBe(failure);
		expect(hook).toHaveBeenCalledOnce();
		expect(hook.mock.calls[0]?.[0].incomplete).toEqual({ reason: "error", error: failure });
		expect(hook.mock.calls[0]?.[0].response.usage).toBeUndefined();
		expect(hook.mock.calls[0]?.[0].response.finishReason.unified).toBe("error");
		expect(loggedText()).not.toContain("secret");
	});

	it("reports a read that fails after the given signal aborted as a cancel, without logging", async () => {
		const client = new AbortController();
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "t1", delta: "so far" })));
				client.signal.addEventListener("abort", () => controller.error(client.signal.reason));
			},
		});
		const hook = vi.fn(passThroughHook);
		const reader = createStreamTransformer(source, requestBody, hook, client.signal).getReader();

		await reader.read();
		const pending = reader.read();
		client.abort("client went away");

		await expect(pending).rejects.toBe("client went away");
		expect(consoleError).not.toHaveBeenCalled();
		expect(hook).toHaveBeenCalledOnce();
		const context = hook.mock.calls[0]?.[0];
		expect(context?.incomplete).toEqual({ reason: "cancelled", cancelReason: "client went away" });
		expect(context?.response.content).toEqual([{ type: "text", text: "so far" }]);
		expect(context?.response.finishReason.unified).toBe("other");
	});

	it("calls the hook once with partial content when the upstream ends without a finish event", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [
			sse({ type: "text-start", id: "t1" }),
			sse({ type: "text-delta", id: "t1", delta: "partial" }),
			sse("[DONE]"),
		];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).toHaveBeenCalledOnce();
		const context = hook.mock.calls[0]?.[0];
		expect(context?.incomplete).toEqual({ reason: "ended" });
		expect(context?.response.content).toEqual([{ type: "text", text: "partial" }]);
		expect(context?.response.usage).toBeUndefined();
		expect(context?.response.finishReason.unified).toBe("other");
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(loggedText()).not.toContain("partial");
	});

	it("passes an error part through and reports an error finish reason when no finish follows", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [
			sse({ type: "text-delta", id: "t1", delta: "partial" }),
			sse({ type: "error", error: { message: "provider overloaded" } }),
			sse("[DONE]"),
		];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).toHaveBeenCalledOnce();
		const context = hook.mock.calls[0]?.[0];
		expect(context?.incomplete).toEqual({ reason: "ended" });
		expect(context?.response.finishReason).toEqual({ unified: "error", raw: undefined });
		expect(context?.response.usage).toBeUndefined();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("does not set incomplete when the stream finishes", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [sse(finishPart), sse("[DONE]")];

		await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(hook).toHaveBeenCalledOnce();
		expect(hook.mock.calls[0]?.[0].incomplete).toBeUndefined();
	});

	it("logs and still closes the stream when the hook throws on an unfinished stream", async () => {
		const hook = vi.fn(() => {
			throw new Error("hook broke");
		});
		const events = [sse({ type: "text-delta", id: "t1", delta: "x" })];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleError.mock.calls[0]?.[0]).toMatch(
			/^afterResponse hook failed on an unfinished stream/,
		);
		expect(loggedText()).not.toContain('"x"');
	});

	it("keeps the upstream usage when the hook returns none on finish", async () => {
		const output = await readAll(
			createStreamTransformer(sourceOf([sse(finishEvent)]), requestBody, ({ response }) => ({
				...response,
				usage: undefined,
			})),
		);

		expect(output).toContain(JSON.stringify(usage));
	});

	it("cancels the upstream without waiting for a slow hook", async () => {
		const cancel = vi.fn();
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse({ type: "text-delta", id: "t1", delta: "x" })));
			},
			cancel,
		});
		const hook = vi.fn(() => new Promise<GatewayResponse>(() => {}));
		const reader = createStreamTransformer(source, requestBody, hook).getReader();

		await reader.read();
		void reader.cancel("gone");
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(cancel).toHaveBeenCalledWith("gone");
	});

	it("calls the hook once with the cancel reason when the client cancels before finish", async () => {
		const hook = vi.fn(passThroughHook);
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(sse({ type: "text-delta", id: "t1", delta: "so far" })),
				);
			},
		});
		const reader = createStreamTransformer(source, requestBody, hook).getReader();

		await reader.read();
		await reader.cancel("client went away");

		expect(hook).toHaveBeenCalledOnce();
		const context = hook.mock.calls[0]?.[0];
		expect(context?.incomplete).toEqual({ reason: "cancelled", cancelReason: "client went away" });
		expect(context?.response.content).toEqual([{ type: "text", text: "so far" }]);
		expect(context?.response.usage).toBeUndefined();
	});

	it("warns once per stream about non-JSON events without logging their payload", async () => {
		const output = await readAll(
			createStreamTransformer(
				sourceOf([sse("secret one"), sse("secret two"), sse(finishEvent), sse("[DONE]")]),
				requestBody,
				passThroughHook,
			),
		);

		expect(output).toContain("data: secret one\n\ndata: secret two\n\n");
		expect(consoleWarn).toHaveBeenCalledOnce();
		expect(consoleWarn.mock.calls[0]?.[0]).toMatch(/not a JSON object/);
		expect(loggedText()).not.toContain("secret");
	});

	it("passes JSON data that is not an object through like non-JSON data", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [sse("null"), sse("42"), sse('"text"'), sse(finishEvent), sse("[DONE]")];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).toHaveBeenCalledOnce();
		expect(consoleWarn).toHaveBeenCalledOnce();
		expect(consoleWarn.mock.calls[0]?.[0]).toMatch(/not a JSON object/);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("passes a stream-start without a warnings array through and still calls the hook", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [
			sse({ type: "stream-start" }),
			sse({ type: "stream-start", warnings: null }),
			sse(finishEvent),
			sse("[DONE]"),
		];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).toHaveBeenCalledOnce();
		expect(hook.mock.calls[0]?.[0].response.warnings).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("does not warn when the stream finishes normally", async () => {
		await readAll(
			createStreamTransformer(
				sourceOf([sse({ type: "text-start", id: "t1" }), sse(finishEvent), sse("[DONE]")]),
				requestBody,
				passThroughHook,
			),
		);

		expect(consoleWarn).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("passes the hook content in the order each block started", async () => {
		const hook = vi.fn(passThroughHook);
		await readAll(
			createStreamTransformer(
				sourceOf(
					[
						{ type: "text-start", id: "t1" },
						{ type: "text-delta", id: "t1", delta: "Checking" },
						{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" },
						{ type: "text-end", id: "t1" },
						{ type: "text-delta", id: "t2", delta: "no start" },
						finishEvent,
					].map(sse),
				),
				requestBody,
				hook,
			),
		);

		expect(hook).toHaveBeenCalledOnce();
		expect(hook.mock.calls[0]?.[0].response.content).toEqual([
			{ type: "text", text: "Checking" },
			{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" },
			{ type: "text", text: "no start" },
		]);
	});

	it("passes version 4 parts to the hook and forwards them unchanged", async () => {
		const citations = [
			{ source: { type: "source", sourceType: "url", id: "s", url: "https://e.com" } },
		];
		const events = [
			{ type: "text-start", id: "t1" },
			{ type: "text-delta", id: "t1", delta: "Hi" },
			{ type: "text-end", id: "t1", citations },
			{ type: "custom", kind: "acme.note" },
			{ type: "reasoning-file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
			{ type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
			finishEvent,
		];
		const hook = vi.fn(passThroughHook);
		const output = await readAll(
			createStreamTransformer(sourceOf(events.map(sse)), requestBody, hook),
		);

		expect(hook.mock.calls[0]?.[0].response.content).toEqual([
			{ type: "text", text: "Hi", citations },
			events[3],
			events[4],
			events[5],
		]);
		expect(output).toContain(sse(events[2]));
		expect(output).toContain(sse(events[3]));
	});

	it("passes the providerMetadata of text and reasoning parts to the hook", async () => {
		const signature = { anthropic: { signature: "sig" } };
		const events = [
			{ type: "reasoning-start", id: "r1" },
			{ type: "reasoning-delta", id: "r1", delta: "Hm", providerMetadata: signature },
			{ type: "reasoning-end", id: "r1" },
			{ type: "text-start", id: "t1", providerMetadata: { acme: { id: "m1" } } },
			{ type: "text-delta", id: "t1", delta: "Hi" },
			{ type: "text-end", id: "t1" },
			finishEvent,
		];
		const hook = vi.fn(passThroughHook);
		const output = await readAll(
			createStreamTransformer(sourceOf(events.map(sse)), requestBody, hook),
		);

		expect(hook.mock.calls[0]?.[0].response.content).toStrictEqual([
			{ type: "reasoning", text: "Hm", providerMetadata: signature },
			{ type: "text", text: "Hi", providerMetadata: { acme: { id: "m1" } } },
		]);
		expect(output).toContain(sse(events[1]));
		expect(output).toContain(sse(events[3]));
	});

	it("passes the response metadata to the hook and forwards the part unchanged", async () => {
		const metadata = {
			type: "response-metadata",
			id: "resp_1",
			modelId: "gpt-5-2025",
			timestamp: "2026-11-01T10:00:00.000Z",
		};
		const hook = vi.fn(passThroughHook);
		const output = await readAll(
			createStreamTransformer(sourceOf([sse(metadata), sse(finishEvent)]), requestBody, hook),
		);

		expect(hook.mock.calls[0]?.[0].response.response).toStrictEqual({
			id: "resp_1",
			modelId: "gpt-5-2025",
			timestamp: "2026-11-01T10:00:00.000Z",
		});
		expect(output.startsWith(sse(metadata))).toBe(true);
	});

	it("passes the response metadata to the hook when the stream ends without finish", async () => {
		const hook = vi.fn(passThroughHook);
		await readAll(
			createStreamTransformer(
				sourceOf([sse({ type: "response-metadata", id: "resp_1" })]),
				requestBody,
				hook,
			),
		);

		expect(hook.mock.calls[0]?.[0].incomplete).toEqual({ reason: "ended" });
		expect(hook.mock.calls[0]?.[0].response.response).toStrictEqual({ id: "resp_1" });
	});

	it("parses an event split across chunks mid-JSON", async () => {
		const event = sse({ type: "text-delta", id: "t1", delta: "split" });
		const output = await readAll(
			createStreamTransformer(
				sourceOf([event.slice(0, 20), event.slice(20)]),
				requestBody,
				passThroughHook,
			),
		);

		expect(output).toBe(event);
	});
});
