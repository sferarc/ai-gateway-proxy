import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createStreamTransformer, StreamContentAggregator } from "./stream";
import type { GatewayResponse } from "./types";

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
			} as LanguageModelV3StreamPart);
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
				data: new Uint8Array([1, 2, 3]),
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
			expect(response.content[0]).toMatchObject({ type: "file" });
		});

		it("includes source content", () => {
			const aggregator = new StreamContentAggregator();

			aggregator.process({
				type: "source",
				id: "source-1",
				url: "https://example.com",
			} as LanguageModelV3StreamPart);
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
const requestBody = { prompt: [] } as unknown as LanguageModelV3CallOptions;

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

const passThroughHook = ({ response }: { response: GatewayResponse }) => response;

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
			({ response }: { request: LanguageModelV3CallOptions; response: GatewayResponse }) => ({
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
		expect(hook).not.toHaveBeenCalled();
		expect(loggedText()).not.toContain("secret");
	});

	it("warns once and closes normally when the upstream ends without a finish event", async () => {
		const hook = vi.fn(passThroughHook);
		const events = [sse({ type: "text-delta", id: "t1", delta: "secret" }), sse("[DONE]")];

		const output = await readAll(createStreamTransformer(sourceOf(events), requestBody, hook));

		expect(output).toBe(events.join(""));
		expect(hook).not.toHaveBeenCalled();
		expect(consoleWarn).toHaveBeenCalledOnce();
		expect(consoleWarn.mock.calls[0]?.[0]).toMatch(
			/without a finish event, afterResponse was not called/,
		);
		expect(consoleError).not.toHaveBeenCalled();
		expect(loggedText()).not.toContain("secret");
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
