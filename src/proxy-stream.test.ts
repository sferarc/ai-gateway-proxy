import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const encoder = new TextEncoder();
const requestBody = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };

const upstreamUsage: LanguageModelV4Usage = {
	inputTokens: { total: 12, noCache: 10, cacheRead: 2, cacheWrite: 0 },
	outputTokens: { total: 30, text: 20, reasoning: 10 },
};

const upstreamFinish: LanguageModelV4StreamPart = {
	type: "finish",
	finishReason: { unified: "stop", raw: "end_turn" },
	usage: upstreamUsage,
	providerMetadata: { gateway: { cost: "0.0042" } },
};

const contentParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [{ type: "other", message: "heads up" }] },
	{ type: "reasoning-start", id: "r1" },
	{ type: "reasoning-delta", id: "r1", delta: "Think" },
	{ type: "reasoning-delta", id: "r1", delta: "ing" },
	{ type: "reasoning-end", id: "r1" },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "world" },
	{ type: "text-end", id: "t1" },
	{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"q":"x"}' },
	{ type: "text-start", id: "t2" },
	{ type: "text-delta", id: "t2", delta: "unterminated" },
];

function sse(part: LanguageModelV4StreamPart | string): string {
	return `data: ${typeof part === "string" ? part : JSON.stringify(part)}\n\n`;
}

function upstreamResponse(
	body: ReadableStream<Uint8Array> | string,
	contentType = "text/event-stream",
): Response {
	return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function streamingRequest(): Request {
	return new Request("http://localhost/api/language-model", {
		method: "POST",
		body: JSON.stringify(requestBody),
		headers: {
			"content-type": "application/json",
			"ai-language-model-streaming": "true",
			"ai-language-model-id": "test/model",
		},
	});
}

function events(output: string): string[] {
	return output
		.split("\n\n")
		.filter(Boolean)
		.map((event) => `${event}\n\n`);
}

type AfterResponse = NonNullable<CreateGatewayProxyOptions["afterResponse"]>;

function spyHook(transform: (response: GatewayResponse) => GatewayResponse = (r) => r) {
	return vi.fn<AfterResponse>(({ response }) => transform(response));
}

async function callProxy(afterResponse: AfterResponse): Promise<Response> {
	const proxy = createGatewayProxy({ afterResponse });
	return proxy(streamingRequest(), { params: Promise.resolve({ segments: ["language-model"] }) });
}

describe("createGatewayProxy streaming with afterResponse", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		process.env.AI_GATEWAY_API_KEY = "test-key";
	});

	afterEach(() => {
		delete process.env.AI_GATEWAY_API_KEY;
	});

	it("calls the hook once with the upstream usage and the aggregated content in order", async () => {
		mockFetch.mockResolvedValueOnce(
			upstreamResponse([...contentParts, upstreamFinish].map(sse).join("")),
		);
		const hook = spyHook();

		const response = await callProxy(hook);
		await response.text();

		expect(hook).toHaveBeenCalledOnce();
		const { request, response: seen } = hook.mock.calls[0]?.[0] ?? {};
		expect(request).toEqual(requestBody);
		expect(seen).toEqual({
			content: [
				{ type: "reasoning", text: "Thinking" },
				{ type: "text", text: "Hello world" },
				{ type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"q":"x"}' },
				{ type: "text", text: "unterminated" },
			],
			finishReason: { unified: "stop", raw: "end_turn" },
			usage: upstreamUsage,
			warnings: [{ type: "other", message: "heads up" }],
			providerMetadata: { gateway: { cost: "0.0042" } },
		});
	});

	it("sends the hook's usage in the finish event and every other event unchanged", async () => {
		const upstream = [...contentParts.map(sse), sse(upstreamFinish), sse("[DONE]")];
		mockFetch.mockResolvedValueOnce(
			upstreamResponse(upstream.join(""), "text/event-stream; charset=utf-8"),
		);
		const meteredUsage: LanguageModelV4Usage = {
			inputTokens: { total: 100, noCache: 90, cacheRead: 10, cacheWrite: 0 },
			outputTokens: { total: 200, text: 150, reasoning: 50 },
		};
		const hook = spyHook((response) => ({
			...response,
			finishReason: { unified: "length", raw: "max_tokens" },
			usage: meteredUsage,
			providerMetadata: { billing: { units: 300 } },
		}));

		const response = await callProxy(hook);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");

		const received = events(await response.text());
		expect(received).toHaveLength(upstream.length);
		const finishIndex = contentParts.length;
		received.forEach((event, i) => {
			if (i !== finishIndex) expect(event).toBe(upstream[i]);
		});
		expect(JSON.parse(received[finishIndex]?.slice("data: ".length) ?? "")).toEqual({
			type: "finish",
			finishReason: { unified: "length", raw: "max_tokens" },
			usage: meteredUsage,
			providerMetadata: { billing: { units: 300 } },
		});
		expect(hook).toHaveBeenCalledOnce();
	});

	// Pins current behavior: without a finish event the hook never runs, so usage goes unreported.
	it("does not call the hook when the upstream ends without a finish event", async () => {
		const upstream = contentParts.map(sse).join("");
		mockFetch.mockResolvedValueOnce(upstreamResponse(upstream));
		const hook = spyHook();

		const response = await callProxy(hook);

		expect(await response.text()).toBe(upstream);
		expect(hook).not.toHaveBeenCalled();
	});

	it("errors the client stream and skips the hook when the upstream body fails mid-stream", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse(contentParts[5] as LanguageModelV4StreamPart)));
				controller.enqueue(encoder.encode(sse(contentParts[6] as LanguageModelV4StreamPart)));
			},
			pull(controller) {
				controller.error(new Error("upstream reset"));
			},
		});
		mockFetch.mockResolvedValueOnce(upstreamResponse(body));
		const hook = spyHook();

		const response = await callProxy(hook);

		expect(response.status).toBe(200);
		await expect(response.text()).rejects.toThrow("upstream reset");
		expect(hook).not.toHaveBeenCalled();
	});

	it("cancels the upstream body when the client cancels the response", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse(contentParts[5] as LanguageModelV4StreamPart)));
			},
			cancel,
		});
		mockFetch.mockResolvedValueOnce(upstreamResponse(body));
		const hook = spyHook();

		const response = await callProxy(hook);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a response body");

		await reader.read();
		await reader.cancel("client went away");

		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("client went away"));
		expect(hook).not.toHaveBeenCalled();
	});
});
