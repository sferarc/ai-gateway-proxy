import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../examples/nextjs/app/api/ai/[...segments]/route";
import {
	OUTPUT_TOKEN_LIMIT,
	reserveOutputTokens,
	settleUsage,
	usageFor,
} from "../examples/nextjs/lib/usage";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

const mockFetch = vi.fn();
const originalFetch = global.fetch;
const encoder = new TextEncoder();

const finish: LanguageModelV4StreamPart = {
	type: "finish",
	finishReason: { unified: "stop", raw: "stop" },
	usage: {
		inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 5, text: 5, reasoning: 0 },
	},
};

function sse(parts: LanguageModelV4StreamPart[], { end }: { end: boolean }) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const part of parts)
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
			if (end) controller.close();
		},
	});
}

function upstreamStream(parts: LanguageModelV4StreamPart[], end = true): Response {
	return new Response(sse(parts, { end }), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function call(
	token: string,
	path = "language-model",
	body: object | string = { prompt: [], maxOutputTokens: 1024 },
) {
	return POST(
		new Request(`http://localhost/api/ai/${path}`, {
			method: "POST",
			body: typeof body === "string" ? body : JSON.stringify(body),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"ai-language-model-streaming": "true",
				"ai-language-model-id": "test/model",
			},
		}),
		{ params: Promise.resolve({ segments: path.split("/") }) },
	);
}

function sentMaxOutputTokens(callIndex: number): unknown {
	return JSON.parse(mockFetch.mock.calls[callIndex][1].body).maxOutputTokens;
}

// The route's totals are module state, so each test spends a different demo caller or a fresh limit.
describe("examples/nextjs proxy route", () => {
	beforeAll(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
		global.fetch = mockFetch;
	});
	afterAll(() => {
		vi.unstubAllEnvs();
		global.fetch = originalFetch;
	});
	beforeEach(() => mockFetch.mockReset());

	it("charges a finished stream its reported usage", async () => {
		const before = usageFor("alice");
		mockFetch.mockResolvedValueOnce(upstreamStream([finish]));
		const response = await call("demo-token-alice");
		await response.text();
		expect(sentMaxOutputTokens(0)).toBe(1024);
		expect(usageFor("alice")).toEqual({
			calls: before.calls + 1,
			inputTokens: before.inputTokens + 7,
			outputTokens: before.outputTokens + 5,
		});
	});

	it("caps a call without maxOutputTokens at what the caller has left", async () => {
		const before = usageFor("alice");
		mockFetch.mockResolvedValueOnce(upstreamStream([finish]));
		await (await call("demo-token-alice", "language-model", { prompt: [] })).text();
		expect(sentMaxOutputTokens(0)).toBe(OUTPUT_TOKEN_LIMIT - before.outputTokens);
		expect(usageFor("alice")).toEqual({
			calls: before.calls + 1,
			inputTokens: before.inputTokens + 7,
			outputTokens: before.outputTokens + 5,
		});
	});

	// JSON has no NaN, so null stands for it on the wire, and 1e999 parses to Infinity.
	it.each([
		["a string", '{"prompt":[],"maxOutputTokens":"lots"}'],
		["NaN, sent as null", '{"prompt":[],"maxOutputTokens":null}'],
		["a negative number", '{"prompt":[],"maxOutputTokens":-1}'],
		["zero", '{"prompt":[],"maxOutputTokens":0}'],
		["a fraction", '{"prompt":[],"maxOutputTokens":1.5}'],
		["a number past the safe integers", `{"prompt":[],"maxOutputTokens":${2 ** 53}}`],
		["Infinity", '{"prompt":[],"maxOutputTokens":1e999}'],
	])("answers 400 to a maxOutputTokens that is %s, before charging anything", async (_, body) => {
		const before = usageFor("alice");
		const response = await call("demo-token-alice", "language-model", body);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				message: "maxOutputTokens must be a positive integer",
				type: "invalid_request_error",
			},
		});
		expect(mockFetch).not.toHaveBeenCalled();
		expect(usageFor("alice")).toEqual(before);
	});

	it("still caps and charges plain calls after a crafted maxOutputTokens", async () => {
		await call("demo-token-alice", "language-model", '{"prompt":[],"maxOutputTokens":"lots"}');
		const before = usageFor("alice");
		mockFetch.mockResolvedValueOnce(upstreamStream([finish]));
		await (
			await call("demo-token-alice", "language-model", { prompt: [], maxOutputTokens: 100 })
		).text();
		expect(sentMaxOutputTokens(0)).toBe(100);
		expect(usageFor("alice").outputTokens).toBe(before.outputTokens + 5);
	});

	it("releases the cap when the gateway answers with an error", async () => {
		const before = usageFor("alice");
		mockFetch.mockResolvedValueOnce(
			Response.json({ error: { message: "bad", type: "invalid_request_error" } }, { status: 400 }),
		);
		expect((await call("demo-token-alice")).status).toBe(400);
		expect(usageFor("alice")).toEqual({ ...before, calls: before.calls + 1 });
	});

	it("refuses calls the route does not meter, such as embeddings", async () => {
		const response = await call("demo-token-alice", "embedding-model", { values: ["hi"] });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: {
				message: "This route does not serve embedding calls",
				type: "invalid_request_error",
			},
		});
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("keeps the cap charged for a stream cancelled before its finish event, so the limit still ends", async () => {
		const delta: LanguageModelV4StreamPart = { type: "text-delta", id: "t1", delta: "hi" };
		mockFetch.mockImplementation(async () => upstreamStream([delta], false));
		let calls = 0;
		for (;;) {
			const response = await call("demo-token-bob");
			if (response.status === 403) break;
			const reader = (response.body as ReadableStream<Uint8Array>).getReader();
			await reader.read();
			await reader.cancel("client went away");
			calls++;
			expect(calls).toBeLessThanOrEqual(Math.ceil(OUTPUT_TOKEN_LIMIT / 1024));
		}
		await vi.waitFor(() => expect(usageFor("bob").outputTokens).toBe(OUTPUT_TOKEN_LIMIT));
		expect(calls).toBe(Math.ceil(OUTPUT_TOKEN_LIMIT / 1024));
		expect(sentMaxOutputTokens(calls - 1)).toBe(OUTPUT_TOKEN_LIMIT % 1024);
	});
});

describe("examples/nextjs output token reservation", () => {
	it("gives concurrent calls only what is left after the calls before them", () => {
		const caps = Array.from({ length: 4 }, () => reserveOutputTokens("parallel", 8000));
		expect(caps).toEqual([8000, 8000, OUTPUT_TOKEN_LIMIT - 16_000, undefined]);
	});

	it("refuses a requested cap that is not a positive integer without storing it", () => {
		for (const requested of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
			expect(() => reserveOutputTokens("invalid", requested)).toThrow(RangeError);
		}
		expect(usageFor("invalid")).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
	});

	it("refuses to store a non-finite reported usage and keeps the cap charged", () => {
		reserveOutputTokens("settle", 500);
		const before = usageFor("settle");
		expect(() => settleUsage("settle", 500, { outputTokens: Number.NaN })).toThrow(RangeError);
		expect(() =>
			settleUsage("settle", 500, { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 5 }),
		).toThrow(RangeError);
		expect(usageFor("settle")).toEqual(before);
		expect(reserveOutputTokens("settle", 1000)).toBe(1000);
	});
});
