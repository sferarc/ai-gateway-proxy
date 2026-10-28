import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { GatewayResponse } from "./types";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

type Metered = {
	modelId: string | undefined;
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	maxOutputTokens: number | undefined;
	complete: boolean;
};

// Same hooks as "Example: cap, meter and mask" in README.md; change both together.
function readmeProxy(meter: (usage: Metered) => Promise<void>) {
	return createGatewayProxy({
		beforeRequest: ({ request }) => ({
			...request,
			maxOutputTokens: Math.min(request.maxOutputTokens ?? 1024, 1024),
		}),
		afterResponse: async ({ request, modelId, response, incomplete }) => {
			await meter({
				modelId,
				inputTokens: response.usage?.inputTokens.total,
				outputTokens: response.usage?.outputTokens.total,
				maxOutputTokens: request.maxOutputTokens,
				complete: incomplete === undefined,
			});
			return response;
		},
		onError: ({ error, status }) =>
			status >= 500
				? { error: { message: "The model provider is unavailable", type: "gateway_error" } }
				: error,
	});
}

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const generateResult: GatewayResponse = {
	content: [{ type: "text", text: "Hello" }],
	finishReason: { unified: "stop", raw: "stop" },
	usage,
	warnings: [],
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function sseResponse(parts: LanguageModelV4StreamPart[]): Response {
	const body = parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function languageModelRequest(body: Record<string, unknown>, streaming = false): Request {
	return new Request("http://localhost/api/ai/language-model", {
		method: "POST",
		body: JSON.stringify({ prompt: [], ...body }),
		headers: {
			"content-type": "application/json",
			"ai-language-model-id": "openai/gpt-5",
			"ai-language-model-streaming": String(streaming),
		},
	});
}

const context = { params: Promise.resolve({ segments: ["language-model"] }) };

function upstreamBody(): Record<string, unknown> {
	const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
	return JSON.parse(init.body as string);
}

describe("README example: cap, meter and mask", () => {
	let consoleError: MockInstance<typeof console.error>;
	const meter = vi.fn<(usage: Metered) => Promise<void>>();

	beforeEach(() => {
		vi.resetAllMocks();
		vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		consoleError.mockRestore();
	});

	it.each([
		[undefined, 1024],
		[4096, 1024],
		[100, 100],
	])("sends maxOutputTokens %s upstream as %s", async (requested, sent) => {
		mockFetch.mockResolvedValueOnce(jsonResponse(generateResult));

		await readmeProxy(meter)(languageModelRequest({ maxOutputTokens: requested }), context);

		expect(upstreamBody().maxOutputTokens).toBe(sent);
	});

	it("meters a non-streamed call and forwards the gateway body unchanged", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(generateResult));

		const response = await readmeProxy(meter)(
			languageModelRequest({ maxOutputTokens: 4096 }),
			context,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(generateResult);
		expect(meter).toHaveBeenCalledExactlyOnceWith({
			modelId: "openai/gpt-5",
			inputTokens: 7,
			outputTokens: 5,
			maxOutputTokens: 1024,
			complete: true,
		});
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("meters a finished stream and forwards the upstream finish event", async () => {
		const finish: LanguageModelV4StreamPart = {
			type: "finish",
			finishReason: { unified: "stop", raw: "stop" },
			usage,
		};
		mockFetch.mockResolvedValueOnce(
			sseResponse([
				{ type: "text-start", id: "t1" },
				{ type: "text-delta", id: "t1", delta: "Hi" },
				{ type: "text-end", id: "t1" },
				finish,
			]),
		);

		const response = await readmeProxy(meter)(languageModelRequest({}, true), context);
		const output = await response.text();

		expect(output).toContain(`data: ${JSON.stringify(finish)}`);
		expect(meter).toHaveBeenCalledExactlyOnceWith({
			modelId: "openai/gpt-5",
			inputTokens: 7,
			outputTokens: 5,
			maxOutputTokens: 1024,
			complete: true,
		});
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("meters a stream that ends before finish with unknown usage", async () => {
		mockFetch.mockResolvedValueOnce(
			sseResponse([
				{ type: "text-start", id: "t1" },
				{ type: "text-delta", id: "t1", delta: "Hi" },
			]),
		);

		const response = await readmeProxy(meter)(languageModelRequest({}, true), context);
		await response.text();

		expect(meter).toHaveBeenCalledExactlyOnceWith({
			modelId: "openai/gpt-5",
			inputTokens: undefined,
			outputTokens: undefined,
			maxOutputTokens: 1024,
			complete: false,
		});
	});

	it("masks an upstream server error", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: { message: "provider stack trace", type: "internal_error" } }, 503),
		);

		const response = await readmeProxy(meter)(languageModelRequest({}), context);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { message: "The model provider is unavailable", type: "gateway_error" },
		});
		expect(meter).not.toHaveBeenCalled();
	});

	it("forwards a client error as the gateway sent it", async () => {
		const error = { error: { message: "Model not found", type: "model_not_found" } };
		mockFetch.mockResolvedValueOnce(jsonResponse(error, 404));

		const response = await readmeProxy(meter)(languageModelRequest({}), context);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual(error);
	});
});
