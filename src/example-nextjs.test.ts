import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../examples/nextjs/app/api/ai/[...segments]/route";
import { OUTPUT_TOKEN_LIMIT, reserveOutputTokens, usageFor } from "../examples/nextjs/lib/usage";

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

function call(token: string, path = "language-model", body: object = { prompt: [] }) {
	return POST(
		new Request(`http://localhost/api/ai/${path}`, {
			method: "POST",
			body: JSON.stringify(body),
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

	it("passes a requested cap of 0 instead of refusing it", () => {
		expect(reserveOutputTokens("zero", 0)).toBe(0);
	});
});
