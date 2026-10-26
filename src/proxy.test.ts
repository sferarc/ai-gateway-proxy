import { createGatewayProvider } from "@ai-sdk/gateway";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { GatewayError, GatewayResponse } from "./types";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockRequest(
	url: string,
	options: {
		method?: string;
		body?: unknown;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	} = {},
): Request {
	return new Request(url, {
		method: options.method ?? "POST",
		signal: options.signal,
		body: options.body ? JSON.stringify(options.body) : undefined,
		headers: {
			"content-type": "application/json",
			...options.headers,
		},
	});
}

function createMockContext(segments: string[] = []): {
	params: Promise<{ segments?: string[] }>;
} {
	return {
		params: Promise.resolve({ segments }),
	};
}

function createMockGatewayResponse(overrides: Partial<GatewayResponse> = {}): GatewayResponse {
	return {
		content: [{ type: "text", text: "Hello!" }],
		finishReason: { unified: "stop", raw: undefined },
		usage: {
			inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
			outputTokens: { total: 5, text: undefined, reasoning: undefined },
		},
		warnings: [],
		...overrides,
	};
}

function createMockHttpResponse(
	body: unknown,
	options: { status?: number; statusText?: string } = {},
): Response {
	return new Response(JSON.stringify(body), {
		status: options.status ?? 200,
		statusText: options.statusText ?? "OK",
		headers: { "content-type": "application/json" },
	});
}

async function expectGatewayError(
	response: Response,
	status: number,
	type: string,
	message: string,
): Promise<void> {
	expect(response.status).toBe(status);
	expect(response.headers.get("content-type")).toBe("application/json");
	expect(await response.json()).toEqual({ error: { message, type } });
}

describe("createGatewayProxy", () => {
	let consoleError: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.resetAllMocks();
		delete process.env.AI_GATEWAY_API_KEY;
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		delete process.env.AI_GATEWAY_API_KEY;
		consoleError.mockRestore();
	});

	async function expectProxyFailure(response: Response): Promise<void> {
		await expectGatewayError(response, 500, "proxy_error", "Error proxying request to AI Gateway");
		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"AI Gateway proxy request failed:",
			expect.any(Error),
		);
	}

	describe("authentication", () => {
		it("uses API key when AI_GATEWAY_API_KEY is set", async () => {
			process.env.AI_GATEWAY_API_KEY = "test-api-key";
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						authorization: "Bearer test-api-key",
						"ai-gateway-auth-method": "api-key",
					}),
				}),
			);
		});

		it("falls back to OIDC token when API key is not set", async () => {
			vi.mocked(getVercelOidcToken).mockResolvedValueOnce("oidc-token-123");
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(getVercelOidcToken).toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						authorization: "Bearer oidc-token-123",
						"ai-gateway-auth-method": "oidc",
					}),
				}),
			);
		});

		it("keeps gateway headers authoritative over custom headers in any casing", async () => {
			vi.mocked(getVercelOidcToken).mockResolvedValueOnce("oidc-token-123");
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				headers: {
					Authorization: "Bearer user-token",
					"AI-Gateway-Auth-Method": "api-key",
					"AI-Gateway-Protocol-Version": "9.9.9",
					"AI-Language-Model-Id": "custom-model",
					"AI-Language-Model-Streaming": "true",
					"Content-Type": "text/plain",
					"x-custom": "value",
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				headers: { "ai-language-model-id": "gpt-4" },
			});

			await proxy(request, createMockContext(["chat"]));

			const sent = new Headers(mockFetch.mock.calls[0][1].headers);
			expect(sent.get("authorization")).toBe("Bearer oidc-token-123");
			expect(sent.get("ai-gateway-auth-method")).toBe("oidc");
			expect(sent.get("ai-gateway-protocol-version")).toBe("0.0.1");
			expect(sent.get("ai-language-model-id")).toBe("gpt-4");
			expect(sent.has("ai-language-model-streaming")).toBe(false);
			expect(sent.get("content-type")).toBe("application/json");
			expect(sent.get("x-custom")).toBe("value");
		});

		it("returns 500 when no authentication is available", async () => {
			vi.mocked(getVercelOidcToken).mockRejectedValueOnce(new Error("No OIDC token"));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectGatewayError(
				response,
				500,
				"authentication_error",
				"AI Gateway authentication not configured: set AI_GATEWAY_API_KEY or deploy on Vercel with OIDC enabled",
			);
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe("request handling", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("constructs upstream URL from segments", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/v1/chat", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["v1", "chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				"https://ai-gateway.vercel.sh/v1/ai/v1/chat",
				expect.any(Object),
			);
		});

		it("forwards query parameters", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat?model=gpt-4&stream=true", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("model=gpt-4&stream=true"),
				expect.any(Object),
			);
		});

		it("uses custom baseUrl when provided", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				baseUrl: "https://custom-gateway.example.com/api",
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				"https://custom-gateway.example.com/api/chat",
				expect.any(Object),
			);
		});

		it("accepts a custom baseUrl with a trailing slash", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				baseUrl: "https://custom-gateway.example.com/api/",
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				"https://custom-gateway.example.com/api/chat",
				expect.any(Object),
			);
		});

		it("forwards a nested path under the default baseUrl", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/ai/language-model", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["language-model"]));

			expect(mockFetch).toHaveBeenCalledWith(
				"https://ai-gateway.vercel.sh/v1/ai/language-model",
				expect.any(Object),
			);
		});

		it.each([
			[["..", "x"]],
			[["a", "..", "..", "b"]],
			[["%2e%2e", "x"]],
			[["%2E%2E", "x"]],
			[["a%2F..%2F..", "x"]],
			[["..\\x"]],
		])("returns 400 without calling fetch for segments %j", async (segments) => {
			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/ai/x", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(segments));

			await expectGatewayError(response, 400, "invalid_request_error", "Invalid path");
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it.each(["../x", "/x", "https://evil.example.com/x"])(
			"returns 400 without calling fetch when extractPath returns %j",
			async (path) => {
				const proxy = createGatewayProxy({ extractPath: () => path });
				const request = createMockRequest("http://localhost/api/ai/x", {
					body: { prompt: [] },
				});

				const response = await proxy(request);

				await expectGatewayError(response, 400, "invalid_request_error", "Invalid path");
				expect(mockFetch).not.toHaveBeenCalled();
			},
		);

		it("includes custom headers", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				headers: { "x-custom-header": "custom-value" },
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						"x-custom-header": "custom-value",
					}),
				}),
			);
		});

		it("forwards ai-language-model headers", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				headers: {
					"ai-language-model-id": "gpt-4",
					"ai-language-model-streaming": "true",
				},
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						"ai-language-model-id": "gpt-4",
						"ai-language-model-streaming": "true",
					}),
				}),
			);
		});

		it("returns 400 for invalid JSON body", async () => {
			const proxy = createGatewayProxy();
			const request = new Request("http://localhost/api/chat", {
				method: "POST",
				body: "invalid json",
				headers: { "content-type": "application/json" },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectGatewayError(response, 400, "invalid_request_error", "Invalid JSON body");
		});
	});

	describe("HTTP method exports", () => {
		it("exports GET, POST, PUT, DELETE, PATCH methods", () => {
			const proxy = createGatewayProxy();

			expect(proxy.GET).toBe(proxy);
			expect(proxy.POST).toBe(proxy);
			expect(proxy.PUT).toBe(proxy);
			expect(proxy.DELETE).toBe(proxy);
			expect(proxy.PATCH).toBe(proxy);
		});
	});

	describe("beforeRequest hook", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("transforms request body synchronously", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				beforeRequest: ({ request }) => ({
					...request,
					maxOutputTokens: 1000,
				}),
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					body: expect.stringContaining('"maxOutputTokens":1000'),
				}),
			);
		});

		it("transforms request body asynchronously", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				beforeRequest: async ({ request }) => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { ...request, temperature: 0.5 };
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					body: expect.stringContaining('"temperature":0.5'),
				}),
			);
		});
	});

	describe("afterResponse hook", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("passes through response by default", async () => {
			const gatewayResponse = createMockGatewayResponse();
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(gatewayResponse));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body).toEqual(gatewayResponse);
		});

		it("modifies response synchronously", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				afterResponse: ({ response }) => ({
					...response,
					providerMetadata: { custom: { modified: true } },
				}),
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(body.providerMetadata).toEqual({ custom: { modified: true } });
		});

		it("modifies response asynchronously", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				afterResponse: async ({ response }) => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return {
						...response,
						content: [{ type: "text", text: "Modified!" }],
					};
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(body.content).toEqual([{ type: "text", text: "Modified!" }]);
		});

		it.each([
			["undefined", undefined],
			["null", null],
		])("forwards the upstream body when the hook returns %s", async (_name, result) => {
			const gatewayResponse = createMockGatewayResponse();
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(gatewayResponse));

			const proxy = createGatewayProxy({
				// @ts-expect-error the hook type does not allow undefined or null
				afterResponse: () => result,
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(JSON.parse(JSON.stringify(gatewayResponse)));
			expect(consoleError).toHaveBeenCalledOnce();
			expect(consoleError).toHaveBeenCalledWith(
				"afterResponse hook returned no response, forwarding the upstream body",
			);
		});

		it.each([
			["a string", "text"],
			["a number", 1],
			["an array", []],
		])("returns 500 when the hook returns %s", async (_name, result) => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				// @ts-expect-error the hook type requires a response object
				afterResponse: () => result,
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectGatewayError(
				response,
				500,
				"proxy_error",
				"Error proxying request to AI Gateway",
			);
			expect(consoleError).toHaveBeenCalledOnce();
		});

		it("receives original request in context", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			let capturedRequest: LanguageModelV4CallOptions | null = null;
			const proxy = createGatewayProxy({
				afterResponse: ({ request, response }) => {
					capturedRequest = request;
					return response;
				},
			});
			const requestBody = {
				prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
				temperature: 0.7,
			};
			const request = createMockRequest("http://localhost/api/chat", {
				body: requestBody,
			});

			await proxy(request, createMockContext(["chat"]));

			expect(capturedRequest).toMatchObject({
				prompt: requestBody.prompt,
				temperature: 0.7,
			});
		});

		it("receives beforeRequest modifications in afterResponse", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			let capturedRequest: LanguageModelV4CallOptions | null = null;
			const proxy = createGatewayProxy({
				beforeRequest: ({ request }) => ({
					...request,
					maxOutputTokens: 500,
				}),
				afterResponse: ({ request, response }) => {
					capturedRequest = request;
					return response;
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [], temperature: 0.5 },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(capturedRequest).toMatchObject({
				temperature: 0.5,
				maxOutputTokens: 500,
			});
		});
	});

	describe("redirects", () => {
		it("sends the upstream call with redirect manual", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});
			await proxy(request, createMockContext(["chat"]));

			expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
		});

		it("returns 502 and does not follow a 3xx on a body request", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }),
			);

			const proxy = createGatewayProxy({});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});
			const response = await proxy(request, createMockContext(["chat"]));

			await expectGatewayError(
				response,
				502,
				"proxy_error",
				"Upstream redirected, the proxy does not follow redirects",
			);
			expect(response.headers.get("location")).toBeNull();
			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it("returns 502 and does not follow a 3xx on a bodyless GET", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }),
			);

			const proxy = createGatewayProxy({});
			const request = createMockRequest("http://localhost/api/config", { method: "GET" });
			const response = await proxy(request, createMockContext(["config"]));

			await expectGatewayError(
				response,
				502,
				"proxy_error",
				"Upstream redirected, the proxy does not follow redirects",
			);
			expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it("does not run onError on a redirect", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response(null, { status: 301, headers: { location: "/x" } }),
			);
			const onError = vi.fn();

			const proxy = createGatewayProxy({ onError });
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(502);
			expect(onError).not.toHaveBeenCalled();
		});
	});

	describe("onError hook", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("returns error response by default", async () => {
			const errorResponse: GatewayError = {
				error: { message: "Model not found", type: "model_not_found" },
			};
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(errorResponse, { status: 404 }));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(404);
			expect(body).toEqual(errorResponse);
		});

		it("allows modifying error response", async () => {
			const errorResponse: GatewayError = {
				error: { message: "Model not found", type: "model_not_found" },
			};
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(errorResponse, { status: 404 }));

			const proxy = createGatewayProxy({
				onError: ({ error }) => ({
					error: {
						...error.error,
						message: "Custom error message",
					},
				}),
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(404);
			expect(body.error.message).toBe("Custom error message");
		});

		it("allows returning custom Response", async () => {
			const errorResponse: GatewayError = {
				error: { message: "Auth error", type: "authentication_error" },
			};
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(errorResponse, { status: 401 }));

			const proxy = createGatewayProxy({
				onError: ({ status }) => {
					if (status === 401) {
						return new Response("Please authenticate", { status: 401 });
					}
					return { error: { message: "Unknown", type: "unknown" } };
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(401);
			expect(await response.text()).toBe("Please authenticate");
		});

		it("receives request and status in context", async () => {
			const errorResponse: GatewayError = {
				error: { message: "Error", type: "error" },
			};
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(errorResponse, { status: 500 }));

			type ErrorContext = {
				request: LanguageModelV4CallOptions;
				error: GatewayError;
				status: number;
			};
			let capturedContext: ErrorContext | undefined;
			const proxy = createGatewayProxy({
				onError: (ctx) => {
					capturedContext = ctx;
					return ctx.error;
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [], temperature: 0.5 },
			});

			await proxy(request, createMockContext(["chat"]));

			expect(capturedContext).toBeDefined();
			expect(capturedContext?.status).toBe(500);
			expect(capturedContext?.request.temperature).toBe(0.5);
			expect(capturedContext?.error.error.message).toBe("Error");
		});

		it("handles async onError", async () => {
			const errorResponse: GatewayError = {
				error: { message: "Original", type: "error" },
			};
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(errorResponse, { status: 500 }));

			const proxy = createGatewayProxy({
				onError: async ({ error }) => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { error: { ...error.error, message: "Async modified" } };
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(body.error.message).toBe("Async modified");
		});

		it.each([
			["undefined", undefined],
			["null", null],
		])("forwards the upstream error body when the hook returns %s", async (_name, result) => {
			const errorResponse: GatewayError = {
				error: { message: "Rate limited", type: "rate_limit_exceeded" },
			};
			const upstream = createMockHttpResponse(errorResponse, { status: 429 });
			upstream.headers.set("retry-after", "3");
			mockFetch.mockResolvedValueOnce(upstream);

			const onError = vi.fn(async () => result);
			// @ts-expect-error the hook type does not allow undefined or null
			const proxy = createGatewayProxy({ onError });
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(onError).toHaveBeenCalledOnce();
			expect(response.status).toBe(429);
			expect(response.headers.get("content-type")).toBe("application/json");
			expect(response.headers.get("retry-after")).toBe("3");
			expect(await response.json()).toEqual(errorResponse);
			expect(consoleError).toHaveBeenCalledOnce();
			expect(consoleError).toHaveBeenCalledWith(
				"onError hook returned no response, forwarding the upstream error body",
			);
		});

		it("handles non-JSON error response from gateway", async () => {
			const html = `<html>
	<head><title>502 Bad Gateway</title></head>
	<body>  <h1>502 Bad Gateway</h1>${"x".repeat(400)}</body>
</html>`;
			mockFetch.mockResolvedValueOnce(
				new Response(html, {
					status: 502,
					statusText: "",
					headers: { "content-type": "text/html" },
				}),
			);

			let receivedError: GatewayError | undefined;
			const proxy = createGatewayProxy({
				onError: ({ error }) => {
					receivedError = error;
					return error;
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(502);
			expect(response.headers.get("content-type")).toBe("application/json");
			expect(body.error.type).toBe("gateway_error");
			expect(body.error.message).toMatch(
				/^AI Gateway returned 502: <html> <head><title>502 Bad Gateway<\/title><\/head> <body> <h1>502 Bad Gateway<\/h1>x+$/,
			);
			expect(body.error.message).toHaveLength("AI Gateway returned 502: ".length + 200);
			expect(receivedError).toEqual(body);
		});

		it("names the status when a failed response has an empty body", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response(null, { status: 503, statusText: "Service Unavailable" }),
			);

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(503);
			expect(body.error).toEqual({
				message: "AI Gateway returned 503 Service Unavailable",
				type: "gateway_error",
			});
		});

		it("names the status when an empty failed response has no status text", async () => {
			mockFetch.mockResolvedValueOnce(new Response("  ", { status: 503, statusText: "" }));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const body = await (await proxy(request, createMockContext(["chat"]))).json();

			expect(body.error.message).toBe("AI Gateway returned 503");
		});

		it.each([
			['{"message":"Bad gateway"}', 'AI Gateway returned 502: {"message":"Bad gateway"}'],
			['"Bad gateway"', 'AI Gateway returned 502: "Bad gateway"'],
			["null", "AI Gateway returned 502: null"],
			['{"error":"Bad gateway"}', 'AI Gateway returned 502: {"error":"Bad gateway"}'],
		])("wraps a JSON error body without an error message: %s", async (text, message) => {
			mockFetch.mockResolvedValueOnce(
				new Response(text, {
					status: 502,
					statusText: "",
					headers: { "content-type": "application/json" },
				}),
			);

			let receivedError: GatewayError | undefined;
			const proxy = createGatewayProxy({
				onError: ({ error }) => {
					receivedError = error;
					return { error: { ...error.error, message: `wrapped: ${error.error.message}` } };
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(502);
			expect(receivedError).toEqual({ error: { message, type: "gateway_error" } });
			expect(body.error.message).toBe(`wrapped: ${message}`);
		});
	});

	describe("request header forwarding", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-api-key";
		});

		async function sentHeaders(
			requestHeaders: Record<string, string>,
			options: Parameters<typeof createGatewayProxy>[0] = {},
		): Promise<Headers> {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));
			const proxy = createGatewayProxy(options);
			const request = createMockRequest("http://localhost/api/ai/language-model", {
				body: { prompt: [] },
				headers: requestHeaders,
			});
			await proxy(request, createMockContext(["language-model"]));
			return new Headers(mockFetch.mock.calls[0][1].headers);
		}

		it.each([
			["ai-language-model-id", "openai/gpt-5"],
			["ai-language-model-streaming", "true"],
			["ai-language-model-specification-version", "4"],
			["ai-model-id", "openai/text-embedding-3-small"],
			["ai-embedding-model-specification-version", "4"],
			["ai-image-model-specification-version", "4"],
			["ai-o11y-deployment-id", "dpl_123"],
			["ai-o11y-environment", "preview"],
			["ai-o11y-project-id", "prj_123"],
			["ai-o11y-region", "fra1"],
			["ai-o11y-request-id", "req_123"],
			["idempotency-key", "batch-42"],
			["accept", "text/event-stream"],
		])("forwards %s from the incoming request", async (name, value) => {
			const sent = await sentHeaders({ [name]: value });

			expect(sent.get(name)).toBe(value);
		});

		it("omits the language model id and streaming headers when the request has none", async () => {
			const sent = await sentHeaders({});

			expect(sent.has("ai-language-model-id")).toBe(false);
			expect(sent.has("ai-language-model-streaming")).toBe(false);
		});

		it("never forwards client credentials, cookies, host or unlisted headers", async () => {
			const sent = await sentHeaders({
				authorization: "Bearer client-key",
				"ai-gateway-auth-method": "oidc",
				"ai-gateway-protocol-version": "9.9.9",
				"x-vercel-ai-gateway-team": "other-team",
				cookie: "session=secret",
				host: "evil.example",
				"x-forwarded-for": "10.0.0.1",
			});

			expect(sent.get("authorization")).toBe("Bearer test-api-key");
			expect(sent.get("ai-gateway-auth-method")).toBe("api-key");
			expect(sent.get("ai-gateway-protocol-version")).toBe("0.0.1");
			expect(sent.has("x-vercel-ai-gateway-team")).toBe(false);
			expect(sent.has("cookie")).toBe(false);
			expect(sent.has("host")).toBe(false);
			expect(sent.has("x-forwarded-for")).toBe(false);
		});

		it("keeps model call headers from the request and lets the request override metadata headers", async () => {
			const sent = await sentHeaders(
				{ "ai-o11y-request-id": "from-request" },
				{
					headers: {
						"AI-Model-Id": "option-model",
						"ai-language-model-streaming": "true",
						"ai-o11y-request-id": "from-option",
						"ai-o11y-project-id": "prj_option",
					},
				},
			);

			expect(sent.has("ai-model-id")).toBe(false);
			expect(sent.has("ai-language-model-streaming")).toBe(false);
			expect(sent.get("ai-o11y-request-id")).toBe("from-request");
			expect(sent.get("ai-o11y-project-id")).toBe("prj_option");
		});

		it("routes an embedding model call from @ai-sdk/gateway with its ai-model-id", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse({ embeddings: [[0.1, 0.2]], usage: { tokens: 2 } }),
			);
			const proxy = createGatewayProxy();
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const result = await gateway
				.embeddingModel("openai/text-embedding-3-small")
				.doEmbed({ values: ["hello"] });

			expect(result.embeddings).toEqual([[0.1, 0.2]]);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/embedding-model");
			const sent = new Headers(init.headers);
			expect(sent.get("ai-model-id")).toBe("openai/text-embedding-3-small");
			expect(sent.get("ai-embedding-model-specification-version")).toBe("4");
			expect(sent.has("ai-language-model-id")).toBe(false);
			expect(sent.get("authorization")).toBe("Bearer test-api-key");
		});

		it("runs no hook on an embedding model call from @ai-sdk/gateway", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse({ embeddings: [[0.1, 0.2]], usage: { tokens: 2 } }),
			);
			const beforeRequest = vi.fn(({ request }) => ({ ...request, temperature: 0 }));
			// A usage logger written for language model responses, which embedding responses are not.
			const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => {
				void response.usage?.inputTokens.total;
				return response;
			});
			const proxy = createGatewayProxy({ beforeRequest, afterResponse });
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const result = await gateway
				.embeddingModel("openai/text-embedding-3-small")
				.doEmbed({ values: ["hello"] });

			expect(result.embeddings).toEqual([[0.1, 0.2]]);
			expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ values: ["hello"] });
			expect(beforeRequest).not.toHaveBeenCalled();
			expect(afterResponse).not.toHaveBeenCalled();
		});

		it("runs no onError on a failed call marked with ai-model-id", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse(
					{ error: { message: "Bad input", type: "invalid_request_error" } },
					{ status: 400 },
				),
			);
			const onError = vi.fn();
			const proxy = createGatewayProxy({ onError });

			const response = await proxy(
				createMockRequest("http://localhost/api/ai/image-model", {
					body: { prompt: "a cat" },
					headers: { "ai-model-id": "openai/gpt-image-1" },
				}),
				createMockContext(["image-model"]),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: { message: "Bad input", type: "invalid_request_error" },
			});
			expect(onError).not.toHaveBeenCalled();
		});

		it("runs every hook on a language model call that also sends ai-model-id", async () => {
			mockFetch
				.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()))
				.mockResolvedValueOnce(
					createMockHttpResponse(
						{ error: { message: "Bad input", type: "invalid_request_error" } },
						{ status: 400 },
					),
				);
			const beforeRequest = vi.fn(({ request }) => ({ ...request, maxOutputTokens: 10 }));
			const afterResponse = vi.fn(({ response }) => response);
			const onError = vi.fn(() => ({
				error: { message: "Replaced", type: "invalid_request_error" },
			}));
			const proxy = createGatewayProxy({ beforeRequest, afterResponse, onError });
			const send = () =>
				proxy(
					createMockRequest("http://localhost/api/ai/language-model", {
						body: { prompt: [] },
						headers: { "ai-language-model-id": "openai/gpt-4o", "ai-model-id": "anything" },
					}),
					createMockContext(["language-model"]),
				);

			expect((await send()).status).toBe(200);
			expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
				prompt: [],
				maxOutputTokens: 10,
			});
			expect(beforeRequest).toHaveBeenCalledOnce();
			expect(afterResponse).toHaveBeenCalledOnce();

			const failed = await send();
			expect(failed.status).toBe(400);
			expect(await failed.json()).toEqual({
				error: { message: "Replaced", type: "invalid_request_error" },
			});
			expect(onError).toHaveBeenCalledOnce();
		});

		it.each([
			["language-model"],
			["ai/language-model"],
			["language-model/"],
			["language-model//"],
			["language%2Dmodel"],
			["language%252Dmodel"],
			["Language-Model"],
			["language-model;x=1"],
		])(
			"runs every hook on the language model path %s that sends ai-model-id alone",
			async (path) => {
				mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));
				const beforeRequest = vi.fn(({ request }) => ({ ...request, maxOutputTokens: 10 }));
				const afterResponse = vi.fn(({ response }) => response);
				const proxy = createGatewayProxy({ beforeRequest, afterResponse });

				const response = await proxy(
					createMockRequest(`http://localhost/api/${path}`, {
						body: { prompt: [] },
						headers: { "ai-model-id": "openai/gpt-4o" },
					}),
					createMockContext([path]),
				);

				expect(response.status).toBe(200);
				expect(beforeRequest).toHaveBeenCalledOnce();
				expect(afterResponse).toHaveBeenCalledOnce();
			},
		);

		it.each([
			["LANGUAGE-MODEL/"],
			["%4Canguage-model"],
			["language-model;a=1/"],
			["language%2Dmodel%3Bx=1"],
			["%61i/Language%252DModel//"],
		])("folds the path %s to a language model call", async (path) => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));
			const beforeRequest = vi.fn(({ request }) => request);
			const afterResponse = vi.fn(({ response }) => response);
			const proxy = createGatewayProxy({ beforeRequest, afterResponse });

			await proxy(
				createMockRequest(`http://localhost/api/${path}`, {
					body: { prompt: [] },
					headers: { "ai-model-id": "openai/gpt-4o" },
				}),
				createMockContext([path]),
			);

			expect(beforeRequest).toHaveBeenCalledOnce();
			expect(afterResponse).toHaveBeenCalledOnce();
		});

		it.each([
			["Batch/Status"],
			["batch/status/"],
			["batch;x=1/cancel"],
			["batch//results"],
			["%62atch/%73tatus"],
		])("folds the path %s to a batch read and runs no hook", async (path) => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse({ status: "pending" }));
			const beforeRequest = vi.fn(({ request }) => request);
			const afterResponse = vi.fn(({ response }) => response);
			const proxy = createGatewayProxy({ beforeRequest, afterResponse });

			await proxy(
				createMockRequest(`http://localhost/api/ai/${path}`, { body: { batchId: "batch_1" } }),
				createMockContext(["ai", path]),
			);

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(beforeRequest).not.toHaveBeenCalled();
			expect(afterResponse).not.toHaveBeenCalled();
		});

		it("runs no hook on a batch status or cancel call from @ai-sdk/gateway", async () => {
			mockFetch.mockImplementation(async () =>
				createMockHttpResponse({ status: "pending", requestCounts: { total: 2, pending: 2 } }),
			);
			const beforeRequest = vi.fn(({ request }) => ({ ...request, temperature: 0 }));
			// A usage logger written for language model responses, which batch status bodies are not.
			const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => {
				void response.usage?.inputTokens.total;
				return response;
			});
			const proxy = createGatewayProxy({ beforeRequest, afterResponse });
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const batch = gateway.experimental_batch();
			const status = await batch.doGetBatchStatus({ batchId: "batch_1" });
			expect(batch.doCancelBatch).toBeDefined();
			await batch.doCancelBatch?.({ batchId: "batch_1" });

			expect(status.status).toBe("pending");
			expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
				"https://ai-gateway.vercel.sh/v1/ai/batch/status",
				"https://ai-gateway.vercel.sh/v1/ai/batch/cancel",
			]);
			expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ batchId: "batch_1" });
			expect(beforeRequest).not.toHaveBeenCalled();
			expect(afterResponse).not.toHaveBeenCalled();
		});

		it("runs no onError on a failed batch status call", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse(
					{ error: { message: "Batch not found", type: "not_found_error" } },
					{ status: 404 },
				),
			);
			const onError = vi.fn();
			const proxy = createGatewayProxy({ onError });

			const response = await proxy(
				createMockRequest("http://localhost/api/ai/batch/status", {
					body: { batchId: "batch_1" },
				}),
				createMockContext(["batch", "status"]),
			);

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({
				error: { message: "Batch not found", type: "not_found_error" },
			});
			expect(onError).not.toHaveBeenCalled();
		});

		it.each(["language-model?x/batch/status", "language-model#/batch/cancel"])(
			"runs every hook on a language model call whose path %s only looks like a batch read",
			async (path) => {
				mockFetch
					.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()))
					.mockResolvedValueOnce(
						createMockHttpResponse(
							{ error: { message: "Bad input", type: "invalid_request_error" } },
							{ status: 400 },
						),
					);
				const beforeRequest = vi.fn(({ request }) => ({ ...request, maxOutputTokens: 10 }));
				const afterResponse = vi.fn(({ response }) => response);
				const onError = vi.fn(() => ({
					error: { message: "Replaced", type: "invalid_request_error" },
				}));
				const proxy = createGatewayProxy({ beforeRequest, afterResponse, onError });
				const send = () =>
					proxy(
						createMockRequest("http://localhost/api/ai/language-model", {
							body: { prompt: [] },
							headers: { "ai-language-model-id": "openai/gpt-4o" },
						}),
						createMockContext([path]),
					);

				expect((await send()).status).toBe(200);
				expect(new URL(mockFetch.mock.calls[0][0]).pathname).toBe("/v1/ai/language-model");
				expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
					prompt: [],
					maxOutputTokens: 10,
				});
				expect(beforeRequest).toHaveBeenCalledOnce();
				expect(afterResponse).toHaveBeenCalledOnce();

				expect((await send()).status).toBe(400);
				expect(onError).toHaveBeenCalledOnce();
			},
		);
	});

	describe("upstream response headers", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		const upstreamHeaders = {
			"x-vercel-id": "fra1::iad1::abc-123",
			"x-request-id": "req_123",
			"x-ratelimit-remaining-requests": "0",
			"x-internal-secret": "do-not-forward",
			"set-cookie": "session=1",
			"content-length": "9999",
			"content-encoding": "gzip",
		};

		function expectOnlyAllowlisted(response: Response) {
			expect(response.headers.get("x-vercel-id")).toBe("fra1::iad1::abc-123");
			expect(response.headers.get("x-request-id")).toBe("req_123");
			expect(response.headers.get("x-ratelimit-remaining-requests")).toBe("0");
			expect(response.headers.get("x-internal-secret")).toBeNull();
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(response.headers.get("content-length")).toBeNull();
			expect(response.headers.get("content-encoding")).toBeNull();
		}

		function rateLimited(): Response {
			return new Response(
				JSON.stringify({ error: { message: "Rate limited", type: "rate_limit_exceeded" } }),
				{
					status: 429,
					headers: {
						"content-type": "application/json",
						"retry-after": "2",
						"retry-after-ms": "1500",
						...upstreamHeaders,
					},
				},
			);
		}

		it("forwards allowlisted headers on a JSON response", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response(JSON.stringify(createMockGatewayResponse()), {
					status: 200,
					headers: { "content-type": "application/json", ...upstreamHeaders },
				}),
			);

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", { body: { prompt: [] } });
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			expectOnlyAllowlisted(response);
		});

		it.each([
			["without afterResponse", undefined],
			["with afterResponse", ({ response }: { response: GatewayResponse }) => response],
		])("forwards allowlisted headers on a streamed response %s", async (_, afterResponse) => {
			mockFetch.mockResolvedValueOnce(
				new Response('data: {"type":"finish"}\n\n', {
					status: 200,
					headers: { "content-type": "text/event-stream", ...upstreamHeaders },
				}),
			);

			const proxy = createGatewayProxy({ afterResponse });
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				headers: { "ai-language-model-streaming": "true" },
			});
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.headers.get("content-type")).toBe("text/event-stream");
			expectOnlyAllowlisted(response);
			await response.text();
		});

		it("forwards retry-after on a 429", async () => {
			mockFetch.mockResolvedValueOnce(rateLimited());

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", { body: { prompt: [] } });
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(429);
			expect(response.headers.get("retry-after")).toBe("2");
			expect(response.headers.get("retry-after-ms")).toBe("1500");
			expectOnlyAllowlisted(response);
		});

		it("forwards retry-after on a 429 when onError returns a replacement body", async () => {
			mockFetch.mockResolvedValueOnce(rateLimited());

			const proxy = createGatewayProxy({
				onError: () => ({ error: { message: "Slow down", type: "rate_limit_exceeded" } }),
			});
			const request = createMockRequest("http://localhost/api/chat", { body: { prompt: [] } });
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(429);
			expect(response.headers.get("retry-after")).toBe("2");
			expect(response.headers.get("retry-after-ms")).toBe("1500");
			expectOnlyAllowlisted(response);
			expect(await response.json()).toEqual({
				error: { message: "Slow down", type: "rate_limit_exceeded" },
			});
		});

		it("forwards retry-after and request ids on a bodyless GET", async () => {
			mockFetch.mockResolvedValueOnce(rateLimited());

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });
			const response = await proxy.GET(request, createMockContext(["config"]));

			expect(response.status).toBe(429);
			expect(response.headers.get("content-type")).toBe("application/json");
			expect(response.headers.get("retry-after")).toBe("2");
			expect(response.headers.get("retry-after-ms")).toBe("1500");
			expectOnlyAllowlisted(response);
		});

		it("passes a Response returned by onError through untouched", async () => {
			mockFetch.mockResolvedValueOnce(rateLimited());

			const proxy = createGatewayProxy({
				onError: () => new Response("custom", { status: 503, headers: { "x-custom": "1" } }),
			});
			const request = createMockRequest("http://localhost/api/chat", { body: { prompt: [] } });
			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(503);
			expect(response.headers.get("x-custom")).toBe("1");
			expect(response.headers.has("retry-after")).toBe(false);
			expect(response.headers.has("x-vercel-id")).toBe(false);
		});

		it("lets a client built on @ai-sdk/gateway read retry-after through the proxy", async () => {
			mockFetch.mockResolvedValueOnce(rateLimited());

			const proxy = createGatewayProxy();
			const provider = createGatewayProvider({
				baseURL: "http://localhost/api",
				apiKey: "client-key",
				fetch: (input, init) =>
					proxy(new Request(input, init), createMockContext(["language-model"])),
			});

			const error = await provider("openai/gpt-5")
				.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
				.then(
					() => undefined,
					(e: unknown) => e as { cause?: { responseHeaders?: Record<string, string> } },
				);

			expect(error?.cause?.responseHeaders?.["retry-after"]).toBe("2");
			expect(error?.cause?.responseHeaders?.["retry-after-ms"]).toBe("1500");
		});

		it("omits upstream headers the gateway does not send", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", { body: { prompt: [] } });
			const response = await proxy(request, createMockContext(["chat"]));

			expect([...response.headers.keys()]).toEqual(["content-type"]);
		});
	});

	describe("streaming", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("passes through streaming response without parsing", async () => {
			const streamBody = 'data: {"type":"text"}\n\ndata: {"type":"finish"}\n\n';
			mockFetch.mockResolvedValueOnce(
				new Response(streamBody, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			);

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				headers: { "ai-language-model-streaming": "true" },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("text/event-stream");
			expect(await response.text()).toBe(streamBody);
		});

		it("returns a JSON 500 when a streamed response has no body", async () => {
			mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				headers: { "ai-language-model-streaming": "true" },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectGatewayError(response, 500, "proxy_error", "No response body");
		});

		it("passes an event stream through on a request not marked as streaming", async () => {
			const streamBody = 'data: {"type":"result","videos":[]}\n\n';
			mockFetch.mockResolvedValueOnce(
				new Response(streamBody, {
					status: 200,
					headers: { "content-type": "text/event-stream; charset=utf-8" },
				}),
			);
			const afterResponse = vi.fn();

			const proxy = createGatewayProxy({ afterResponse });
			const request = createMockRequest("http://localhost/api/ai/video-model", {
				body: { prompt: "a cat" },
				headers: { accept: "text/event-stream" },
			});

			const response = await proxy(request, createMockContext(["video-model"]));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
			expect(await response.text()).toBe(streamBody);
			expect(afterResponse).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
		});

		it("returns the videos of a video model call from @ai-sdk/gateway", async () => {
			const video = { type: "base64", data: "AAAA", mediaType: "video/mp4" };
			mockFetch.mockResolvedValueOnce(
				new Response(`data: ${JSON.stringify({ type: "result", videos: [video] })}\n\n`, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			);
			const proxy = createGatewayProxy();
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const model = gateway.videoModel("google/veo-3.0-generate-001");
			if (!model.doGenerate) {
				throw new Error("the gateway video model has no doGenerate");
			}
			const result = await model.doGenerate({
				prompt: "a cat",
				n: 1,
				aspectRatio: undefined,
				resolution: undefined,
				duration: undefined,
				fps: undefined,
				seed: undefined,
				generateAudio: undefined,
				image: undefined,
				frameImages: undefined,
				inputReferences: undefined,
				providerOptions: {},
			});

			expect(result.videos).toEqual([video]);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/video-model");
			expect(new Headers(init.headers).get("accept")).toBe("text/event-stream");
		});

		it("passes a JSON Lines body through instead of parsing it as one JSON value", async () => {
			const linesBody =
				'{"type":"text","id":"a","status":"failed"}\n{"type":"text","id":"b","status":"failed"}\n';
			mockFetch.mockResolvedValueOnce(
				new Response(linesBody, {
					status: 200,
					headers: { "content-type": "application/x-ndjson" },
				}),
			);
			const afterResponse = vi.fn();

			const proxy = createGatewayProxy({ afterResponse });
			const request = createMockRequest("http://localhost/api/ai/batch/results", {
				body: { batchId: "batch_1" },
			});

			const response = await proxy(request, createMockContext(["batch", "results"]));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/x-ndjson");
			expect(await response.text()).toBe(linesBody);
			expect(afterResponse).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
		});

		it("returns the results of a batch from @ai-sdk/gateway", async () => {
			const items = [
				{ type: "text", id: "a", status: "failed", error: { message: "bad" } },
				{ type: "text", id: "b", status: "cancelled" },
			];
			mockFetch.mockResolvedValueOnce(
				new Response(items.map((item) => `${JSON.stringify(item)}\n`).join(""), {
					status: 200,
					headers: { "content-type": "application/x-ndjson" },
				}),
			);
			const proxy = createGatewayProxy();
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const stream = await gateway.experimental_batch().doGetBatchResults({ batchId: "batch_1" });
			const results = await Array.fromAsync(stream);

			expect(results).toEqual(items);
			const [url] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/batch/results");
		});
	});

	describe("bodyless requests", () => {
		const models = {
			models: [
				{
					id: "openai/gpt-5",
					name: "GPT-5",
					specification: { specificationVersion: "v4", provider: "openai", modelId: "gpt-5" },
					modelType: "language",
				},
			],
		};

		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-api-key";
		});

		it("forwards GET without a body and returns the upstream JSON", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(models));

			const proxy = createGatewayProxy({ headers: { "x-custom": "value" } });
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });

			const response = await proxy.GET(request, createMockContext(["config"]));

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(models);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/config");
			expect(init.method).toBe("GET");
			expect(init.body).toBeUndefined();
			expect(init.headers).toEqual({
				"x-custom": "value",
				authorization: "Bearer test-api-key",
				"ai-gateway-auth-method": "api-key",
				"ai-gateway-protocol-version": "0.0.1",
			});
		});

		it("does not call the hooks for GET", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(models));
			const beforeRequest = vi.fn();
			const afterResponse = vi.fn();
			const onError = vi.fn();

			const proxy = createGatewayProxy({ beforeRequest, afterResponse, onError });
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });

			const response = await proxy.GET(request, createMockContext(["config"]));

			expect(response.status).toBe(200);
			expect(beforeRequest).not.toHaveBeenCalled();
			expect(afterResponse).not.toHaveBeenCalled();
			expect(onError).not.toHaveBeenCalled();
		});

		it("keeps gateway headers authoritative over custom headers in any casing on GET", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(models));

			const proxy = createGatewayProxy({
				headers: {
					Authorization: "Bearer user-token",
					"AI-Gateway-Auth-Method": "oidc",
					"AI-Gateway-Protocol-Version": "9.9.9",
				},
			});
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });

			await proxy.GET(request, createMockContext(["config"]));

			const sent = new Headers(mockFetch.mock.calls[0][1].headers);
			expect(sent.get("authorization")).toBe("Bearer test-api-key");
			expect(sent.get("ai-gateway-auth-method")).toBe("api-key");
			expect(sent.get("ai-gateway-protocol-version")).toBe("0.0.1");
		});

		it("returns the upstream status and body when GET fails", async () => {
			const errorBody = { error: { message: "Unauthorized", type: "authentication_error" } };
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse(errorBody, { status: 401, statusText: "Unauthorized" }),
			);
			const onError = vi.fn();

			const proxy = createGatewayProxy({ onError });
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });

			const response = await proxy.GET(request, createMockContext(["config"]));

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual(errorBody);
			expect(onError).not.toHaveBeenCalled();
		});

		it("forwards a DELETE without a body instead of rejecting it as invalid JSON", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse({ ok: true }));
			const beforeRequest = vi.fn();

			const proxy = createGatewayProxy({ beforeRequest });
			const request = createMockRequest("http://localhost/api/ai/config", { method: "DELETE" });

			const response = await proxy.DELETE(request, createMockContext(["config"]));

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true });
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/config");
			expect(init.method).toBe("DELETE");
			expect(init.body).toBeUndefined();
			expect(beforeRequest).not.toHaveBeenCalled();
		});

		it("forwards a DELETE whose body is an empty stream, as Node adapters build it", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse({ ok: true }));
			const beforeRequest = vi.fn();

			const proxy = createGatewayProxy({ beforeRequest });
			// The README's Express adapter passes `Readable.toWeb(req)` for every method but GET and HEAD.
			const request = new Request("http://localhost/api/ai/config", {
				method: "DELETE",
				body: new ReadableStream({ start: (controller) => controller.close() }),
				duplex: "half",
			} as RequestInit);
			expect(request.body).not.toBeNull();

			const response = await proxy.DELETE(request, createMockContext(["config"]));

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true });
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/config");
			expect(init.method).toBe("DELETE");
			expect(init.body).toBeUndefined();
			expect(beforeRequest).not.toHaveBeenCalled();
		});

		it("returns 500 when a GET fetch throws", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/ai/config", { method: "GET" });

			const response = await proxy.GET(request, createMockContext(["config"]));

			await expectProxyFailure(response);
		});

		it("serves getAvailableModels from @ai-sdk/gateway through the proxy", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(models));
			const proxy = createGatewayProxy();
			const gateway = createGatewayProvider({
				baseURL: "http://localhost/api/ai",
				apiKey: "client-key",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, "");
					return proxy(request, createMockContext(path.split("/")));
				},
			});

			const result = await gateway.getAvailableModels();

			expect(result.models.map((model) => model.id)).toEqual(["openai/gpt-5"]);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://ai-gateway.vercel.sh/v1/ai/config");
			expect(init.method).toBe("GET");
			expect(init.headers.authorization).toBe("Bearer test-api-key");
		});
	});

	describe("error handling", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("returns 500 without calling fetch when a sync beforeRequest throws", async () => {
			const proxy = createGatewayProxy({
				beforeRequest: () => {
					throw new Error("hook failed");
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("returns 500 without calling fetch when an async beforeRequest throws", async () => {
			const proxy = createGatewayProxy({
				beforeRequest: async () => {
					throw new Error("hook failed");
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("returns 500 without calling fetch when extractPath throws", async () => {
			const proxy = createGatewayProxy({
				extractPath: () => {
					throw new Error("bad path");
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request);

			await expectProxyFailure(response);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("returns 500 on fetch error", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
		});

		it("forwards the client signal and returns 499 when the client aborts", async () => {
			mockFetch.mockImplementationOnce(
				(_url: string, init: RequestInit) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
					}),
			);

			const controller = new AbortController();
			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
				signal: controller.signal,
			});

			const pending = proxy(request, createMockContext(["chat"]));
			await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
			controller.abort();
			const response = await pending;

			const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
			expect(init.signal).toBe(request.signal);
			expect(response.status).toBe(499);
			expect(response.body).toBeNull();
			expect(consoleError).not.toHaveBeenCalled();
		});

		it("returns 500 when a successful response body is not JSON", async () => {
			mockFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
		});

		it("returns 500 when afterResponse throws", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy({
				afterResponse: async () => {
					throw new Error("hook failed");
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
		});

		it("returns 500 when onError throws", async () => {
			mockFetch.mockResolvedValueOnce(
				createMockHttpResponse(
					{ error: { message: "Bad", type: "gateway_error" } },
					{ status: 400 },
				),
			);

			const proxy = createGatewayProxy({
				onError: async () => {
					throw new Error("hook failed");
				},
			});
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			await expectProxyFailure(response);
		});

		it("handles empty segments", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api", {
				body: { prompt: [] },
			});

			await proxy(request, createMockContext([]));

			expect(mockFetch).toHaveBeenCalledWith(
				"https://ai-gateway.vercel.sh/v1/ai/",
				expect.any(Object),
			);
		});
	});
});
