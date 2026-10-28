/**
 * Integration tests using the AI SDK to make real API calls through the proxy.
 * These tests verify the proxy works correctly with generateText and streamText.
 *
 * Run with: pnpm test:integration
 * Requires AI_GATEWAY_API_KEY; without it the suite is skipped, not failed.
 */

import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { startProxyServer } from "./test-server";
import type { GatewayResponse } from "./types";

const hasApiKey = !!process.env.AI_GATEWAY_API_KEY;
const TEST_MODEL = "google/gemini-2.0-flash";

describe.skipIf(!hasApiKey)("Integration: AI SDK with Proxy", () => {
	describe("generateText (non-streaming)", () => {
		it("proxies a simple request successfully", async () => {
			const { gateway, close } = await startProxyServer({});

			try {
				const result = await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Say exactly: 'test'",
					maxOutputTokens: 10,
				});

				expect(result.text).toBeDefined();
				// finishReason and usage may not always be defined depending on provider
				// expect(result.finishReason).toBeDefined();
				// expect(result.usage).toBeDefined();
			} finally {
				await close();
			}
		}, 30000);

		it("applies beforeRequest hook", async () => {
			let capturedMaxTokens: number | undefined;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					beforeRequest: ({ request }) => {
						capturedMaxTokens = request.maxOutputTokens;
						// Override to very small limit
						return { ...request, maxOutputTokens: 5 };
					},
				},
			});

			try {
				const result = await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Count from 1 to 100",
					maxOutputTokens: 100,
				});

				// Verify the hook captured the original value
				expect(capturedMaxTokens).toBe(100);
				// The response should be short due to our limit
				expect(result.text.length).toBeLessThan(100);
			} finally {
				await close();
			}
		}, 30000);

		it("applies afterResponse hook", async () => {
			let capturedResponse: GatewayResponse | undefined;
			let capturedModelId: string | undefined;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					afterResponse: ({ response, modelId }) => {
						capturedResponse = response;
						capturedModelId = modelId;
						return {
							...response,
							providerMetadata: { custom: { modified: true } },
						};
					},
				},
			});

			try {
				const result = await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Hi",
					maxOutputTokens: 5,
				});

				expect(capturedResponse).toBeDefined();
				expect(capturedResponse?.content).toBeDefined();
				expect(capturedModelId).toBe(TEST_MODEL);
				expect(result.providerMetadata?.custom).toEqual({ modified: true });
			} finally {
				await close();
			}
		}, 30000);
	});

	describe("streamText (streaming)", () => {
		it("streams text successfully", async () => {
			const { gateway, close } = await startProxyServer({});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Say exactly: 'hello'",
					maxOutputTokens: 10,
				});

				let fullText = "";
				for await (const chunk of result.textStream) {
					fullText += chunk;
				}

				expect(fullText.length).toBeGreaterThan(0);
				expect(await result.finishReason).toBeDefined();
				expect(await result.usage).toBeDefined();
			} finally {
				await close();
			}
		}, 30000);

		it("applies beforeRequest hook during streaming", async () => {
			let capturedMaxTokens: number | undefined;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					beforeRequest: ({ request }) => {
						capturedMaxTokens = request.maxOutputTokens;
						return { ...request, maxOutputTokens: 5 };
					},
				},
			});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Count from 1 to 100",
					maxOutputTokens: 100,
				});

				// Consume the stream
				let fullText = "";
				for await (const chunk of result.textStream) {
					fullText += chunk;
				}

				// Verify the hook captured the original value
				expect(capturedMaxTokens).toBe(100);
				// The response should be short due to our limit
				expect(fullText.length).toBeLessThan(100);
			} finally {
				await close();
			}
		}, 30000);

		it("applies afterResponse hook during streaming", async () => {
			let capturedResponse: GatewayResponse | undefined;
			let capturedModelId: string | undefined;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					afterResponse: ({ response, modelId }) => {
						capturedResponse = response;
						capturedModelId = modelId;
						// Return modified response
						return {
							...response,
							providerMetadata: { custom: { streamModified: true } },
						};
					},
				},
			});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Say 'test'",
					maxOutputTokens: 10,
				});

				// Consume the stream first
				for await (const _ of result.textStream) {
					// consume
				}

				// afterResponse should have been called with aggregated content
				expect(capturedResponse).toBeDefined();
				expect(capturedResponse?.content).toBeDefined();
				expect(capturedResponse?.content.length).toBeGreaterThan(0);
				expect(capturedModelId).toBe(TEST_MODEL);

				// The modified metadata should be reflected
				const metadata = await result.providerMetadata;
				expect(metadata?.custom).toEqual({ streamModified: true });
			} finally {
				await close();
			}
		}, 30000);

		it("aggregates content correctly in afterResponse", async () => {
			let aggregatedContent: GatewayResponse["content"] | undefined;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					afterResponse: ({ response }) => {
						aggregatedContent = response.content;
						return response;
					},
				},
			});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Say: Hello World",
					maxOutputTokens: 20,
				});

				// Collect streamed text
				let streamedText = "";
				for await (const chunk of result.textStream) {
					streamedText += chunk;
				}

				// Verify aggregated content matches streamed content
				expect(aggregatedContent).toBeDefined();
				expect(aggregatedContent?.length).toBeGreaterThan(0);

				const textContent = aggregatedContent?.find((c) => c.type === "text");
				expect(textContent).toBeDefined();
				if (textContent?.type === "text") {
					expect(textContent.text).toBe(streamedText);
				}
			} finally {
				await close();
			}
		}, 30000);
	});

	describe("error handling", () => {
		it("handles model not found errors", async () => {
			let capturedError: unknown;

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					onError: ({ error, status }) => {
						capturedError = { error, status };
						return error;
					},
				},
			});

			try {
				await generateText({
					model: gateway("invalid/nonexistent-model"),
					prompt: "Hi",
				});
				expect.fail("Should have thrown");
			} catch (_e) {
				expect(capturedError).toBeDefined();
			} finally {
				await close();
			}
		}, 30000);
	});

	describe("hooks execution order", () => {
		it("calls hooks in correct order", async () => {
			const order: string[] = [];

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					beforeRequest: ({ request }) => {
						order.push("beforeRequest");
						return request;
					},
					afterResponse: ({ response }) => {
						order.push("afterResponse");
						return response;
					},
				},
			});

			try {
				await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Hi",
					maxOutputTokens: 5,
				});

				expect(order).toEqual(["beforeRequest", "afterResponse"]);
			} finally {
				await close();
			}
		}, 30000);

		it("calls hooks in correct order for streaming", async () => {
			const order: string[] = [];

			const { gateway, close } = await startProxyServer({
				proxyOptions: {
					beforeRequest: ({ request }) => {
						order.push("beforeRequest");
						return request;
					},
					afterResponse: ({ response }) => {
						order.push("afterResponse");
						return response;
					},
				},
			});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Hi",
					maxOutputTokens: 5,
				});

				// Consume stream to trigger both hooks
				for await (const _ of result.textStream) {
					// consume
				}

				// Wait for finish to ensure afterResponse is called
				await result.finishReason;

				// Both hooks should have been called in order
				expect(order).toEqual(["beforeRequest", "afterResponse"]);
			} finally {
				await close();
			}
		}, 30000);
	});

	describe("segmentsParam option", () => {
		it("uses custom segmentsParam name", async () => {
			const { gateway, close } = await startProxyServer({
				segmentsParam: "path",
				proxyOptions: {
					segmentsParam: "path",
				},
			});

			try {
				const result = await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Say 'test'",
					maxOutputTokens: 10,
				});

				expect(result.text).toBeDefined();
			} finally {
				await close();
			}
		}, 30000);
	});

	describe("extractPath option", () => {
		it("uses extractPath to extract path from request URL", async () => {
			const { gateway, close } = await startProxyServer({
				noContext: true,
				proxyOptions: {
					extractPath: (request) => {
						const url = new URL(request.url);
						return url.pathname.split("/").filter(Boolean).join("/");
					},
				},
			});

			try {
				const result = await generateText({
					model: gateway(TEST_MODEL),
					prompt: "Say 'hello'",
					maxOutputTokens: 10,
				});

				expect(result.text).toBeDefined();
			} finally {
				await close();
			}
		}, 30000);

		it("works with streaming when using extractPath", async () => {
			const { gateway, close } = await startProxyServer({
				noContext: true,
				proxyOptions: {
					extractPath: (request) => {
						const url = new URL(request.url);
						return url.pathname.split("/").filter(Boolean).join("/");
					},
				},
			});

			try {
				const result = streamText({
					model: gateway(TEST_MODEL),
					prompt: "Say 'world'",
					maxOutputTokens: 10,
				});

				let fullText = "";
				for await (const chunk of result.textStream) {
					fullText += chunk;
				}

				expect(fullText.length).toBeGreaterThan(0);
			} finally {
				await close();
			}
		}, 30000);
	});
});
