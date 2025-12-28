import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	} = {},
): Request {
	return new Request(url, {
		method: options.method ?? "POST",
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

describe("createGatewayProxy", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		delete process.env.AI_GATEWAY_API_KEY;
	});

	afterEach(() => {
		delete process.env.AI_GATEWAY_API_KEY;
	});

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

		it("returns 500 when no authentication is available", async () => {
			vi.mocked(getVercelOidcToken).mockRejectedValueOnce(new Error("No OIDC token"));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(500);
			expect(await response.text()).toBe("AI Gateway authentication not configured");
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

			expect(response.status).toBe(400);
			expect(await response.text()).toBe("Invalid JSON body");
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

		it("receives original request in context", async () => {
			mockFetch.mockResolvedValueOnce(createMockHttpResponse(createMockGatewayResponse()));

			let capturedRequest: LanguageModelV3CallOptions | null = null;
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

			let capturedRequest: LanguageModelV3CallOptions | null = null;
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
				request: LanguageModelV3CallOptions;
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

		it("handles non-JSON error response from gateway", async () => {
			mockFetch.mockResolvedValueOnce(
				new Response("Bad Gateway", {
					status: 502,
					statusText: "Bad Gateway",
				}),
			);

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));
			const body = await response.json();

			expect(response.status).toBe(502);
			expect(body.error.type).toBe("gateway_error");
			expect(body.error.message).toBe("Bad Gateway");
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
	});

	describe("error handling", () => {
		beforeEach(() => {
			process.env.AI_GATEWAY_API_KEY = "test-key";
		});

		it("returns 500 on fetch error", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"));

			const proxy = createGatewayProxy();
			const request = createMockRequest("http://localhost/api/chat", {
				body: { prompt: [] },
			});

			const response = await proxy(request, createMockContext(["chat"]));

			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Error proxying request to AI Gateway");
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
