import { createGatewayProvider } from "@ai-sdk/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse, ProxyErrorCode } from "./types";

const context = { params: Promise.resolve({ segments: ["language-model"] }) };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const generated: GatewayResponse = {
	content: [{ type: "text", text: "Hello" }],
	finishReason: { unified: "stop", raw: "stop" },
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
	warnings: [],
};

const cases: [ProxyErrorCode, CreateGatewayProxyOptions][] = [
	["api_key_missing", { apiKey: () => "" }],
	["invalid_path", { apiKey: "gateway-key", extractPath: () => "../x" }],
	[
		"credential_rejected",
		{
			apiKey: "revoked-key",
			fetch: async () =>
				jsonResponse({ error: { message: "Invalid API key", type: "authentication_error" } }, 401),
		},
	],
	[
		"after_response_invalid",
		{
			apiKey: "gateway-key",
			fetch: async () => jsonResponse(generated),
			afterResponse: ({ response }) =>
				({ ...response, content: "Hello" }) as unknown as GatewayResponse,
		},
	],
];

async function clientError(
	options: CreateGatewayProxyOptions,
	rewrite: (body: { error: Record<string, unknown> }) => void = () => {},
) {
	const proxy = createGatewayProxy(options);
	const bodies: unknown[] = [];
	const provider = createGatewayProvider({
		baseURL: "http://localhost/api",
		apiKey: "client-key",
		fetch: async (input, init) => {
			const response = await proxy(new Request(input, init), context);
			const body = await response.json();
			bodies.push(body);
			rewrite(body);
			return jsonResponse(body, response.status);
		},
	});
	const error = await provider("openai/gpt-5")
		.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
		.then(
			() => undefined,
			(e: unknown) => e as Error & { statusCode?: number; type?: string; isRetryable?: boolean },
		);
	return {
		body: bodies[0],
		seen: error && {
			name: error.name,
			message: error.message,
			statusCode: error.statusCode,
			type: error.type,
			isRetryable: error.isRetryable,
		},
	};
}

describe("proxy error codes", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each(cases)(
		"give an @ai-sdk/gateway client the same error for %s as a body without the code",
		async (code, options) => {
			vi.spyOn(console, "error").mockImplementation(() => {});

			const withCode = await clientError(options);
			const withoutCode = await clientError(options, (body) => {
				delete body.error.code;
			});

			expect(withCode.body).toMatchObject({ error: { code } });
			expect(withCode.seen).toBeDefined();
			expect(withCode.seen).toEqual(withoutCode.seen);
		},
	);
});
