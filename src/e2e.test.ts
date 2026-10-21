/**
 * End-to-end tests that need no gateway key: a real `@ai-sdk/gateway` client calls the proxy over
 * HTTP, and the proxy forwards to a local fake gateway that records what it receives.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProxyServer } from "./test-server";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "e2e-dummy-gateway-key";

type RecordedRequest = {
	method: string | undefined;
	path: string | undefined;
	headers: IncomingMessage["headers"];
	body: Record<string, unknown>;
	/** Resolves with true when the connection closed before the fake gateway ended its response. */
	closedEarly: Promise<boolean>;
};

type Responder = (res: ServerResponse) => void;

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const generateResult = {
	content: [{ type: "text", text: "Hello from the fake gateway" }],
	finishReason: { unified: "stop", raw: "stop" },
	usage,
	warnings: [],
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "stream" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

function sse(part: LanguageModelV4StreamPart): string {
	return `data: ${JSON.stringify(part)}\n\n`;
}

const respondJson: Responder = (res) => {
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify(generateResult));
};

const respondStream: Responder = (res) => {
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.end(streamParts.map(sse).join(""));
};

/** Sends the first text delta, then keeps the stream open until the connection closes. */
const respondStreamThenHang: Responder = (res) => {
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.write(streamParts.slice(0, 3).map(sse).join(""));
};

/** Never answers, so the proxy is still waiting on `fetch` when the client leaves. */
const respondNever: Responder = () => {};

async function startFakeGateway() {
	const requests: RecordedRequest[] = [];
	let respond: Responder = respondJson;
	let onRequest: () => void = () => {};

	const server = createServer(async (req, res) => {
		const closedEarly = new Promise<boolean>((resolve) => {
			res.on("close", () => resolve(!res.writableFinished));
		});
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		requests.push({
			method: req.method,
			path: req.url,
			headers: req.headers,
			body: JSON.parse(Buffer.concat(chunks).toString()),
			closedEarly,
		});
		respond(res);
		onRequest();
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;

	return {
		baseUrl: `http://127.0.0.1:${port}/v1/ai`,
		requests,
		respondWith(responder: Responder) {
			respond = responder;
		},
		nextRequest() {
			return new Promise<void>((resolve) => {
				onRequest = resolve;
			});
		},
		close() {
			server.closeAllConnections();
			return new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

describe("E2E: AI SDK client through the proxy to a fake gateway", () => {
	let upstream: Awaited<ReturnType<typeof startFakeGateway>>;
	let closeProxy: (() => Promise<void>) | undefined;

	beforeEach(async () => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		upstream = await startFakeGateway();
	});

	afterEach(async () => {
		await closeProxy?.();
		closeProxy = undefined;
		await upstream.close();
		vi.unstubAllEnvs();
	});

	async function startProxy(
		proxyOptions: CreateGatewayProxyOptions = {},
		serverOptions: { forwardAbortSignal?: boolean } = {},
	) {
		const { gateway, close } = await startProxyServer({
			...serverOptions,
			proxyOptions: { ...proxyOptions, baseUrl: upstream.baseUrl },
		});
		closeProxy = close;
		return gateway;
	}

	function expectGatewayHeaders(streaming: boolean) {
		expect(upstream.requests).toHaveLength(1);
		const [received] = upstream.requests;
		expect(received.method).toBe("POST");
		expect(received.path).toBe("/v1/ai/language-model");
		expect(received.headers.authorization).toBe(`Bearer ${GATEWAY_KEY}`);
		expect(received.headers["ai-gateway-auth-method"]).toBe("api-key");
		expect(received.headers["ai-gateway-protocol-version"]).toBe("0.0.1");
		expect(received.headers["ai-language-model-id"]).toBe(MODEL);
		expect(received.headers["ai-language-model-streaming"]).toBe(String(streaming));
	}

	describe("generateText", () => {
		it("round-trips text and sends the proxy's credentials upstream", async () => {
			const gateway = await startProxy();

			const result = await generateText({ model: gateway(MODEL), prompt: "Hi" });

			expect(result.text).toBe("Hello from the fake gateway");
			expect(result.finishReason).toBe("stop");
			expect(result.usage.inputTokens).toBe(7);
			expectGatewayHeaders(false);
		});

		it("sends the beforeRequest result upstream", async () => {
			const seen: Array<number | undefined> = [];
			const gateway = await startProxy({
				beforeRequest: ({ request }) => {
					seen.push(request.maxOutputTokens);
					return { ...request, maxOutputTokens: 5 };
				},
			});

			await generateText({ model: gateway(MODEL), prompt: "Hi", maxOutputTokens: 100 });

			expect(seen).toEqual([100]);
			expect(upstream.requests[0].body.maxOutputTokens).toBe(5);
		});

		it("passes the gateway response to afterResponse and returns its result", async () => {
			const seen: GatewayResponse[] = [];
			const gateway = await startProxy({
				afterResponse: ({ response }) => {
					seen.push(response);
					return { ...response, providerMetadata: { custom: { modified: true } } };
				},
			});

			const result = await generateText({ model: gateway(MODEL), prompt: "Hi" });

			expect(seen).toHaveLength(1);
			expect(seen[0].content).toEqual(generateResult.content);
			expect(seen[0].usage).toEqual(usage);
			expect(result.providerMetadata?.custom).toEqual({ modified: true });
		});
	});

	describe("streamText", () => {
		beforeEach(() => {
			upstream.respondWith(respondStream);
		});

		it("round-trips streamed text and sends the proxy's credentials upstream", async () => {
			const gateway = await startProxy();

			const result = streamText({ model: gateway(MODEL), prompt: "Hi" });

			expect(await result.text).toBe("Hello stream");
			expect(await result.finishReason).toBe("stop");
			expectGatewayHeaders(true);
		});

		it("sends the beforeRequest result upstream", async () => {
			const gateway = await startProxy({
				beforeRequest: ({ request }) => ({ ...request, maxOutputTokens: 5 }),
			});

			const result = streamText({ model: gateway(MODEL), prompt: "Hi", maxOutputTokens: 100 });
			await result.consumeStream();

			expect(upstream.requests[0].body.maxOutputTokens).toBe(5);
		});

		it("passes aggregated content to afterResponse and streams its finish event", async () => {
			const seen: GatewayResponse[] = [];
			const gateway = await startProxy({
				afterResponse: ({ response }) => {
					seen.push(response);
					return { ...response, providerMetadata: { custom: { streamModified: true } } };
				},
			});

			const result = streamText({ model: gateway(MODEL), prompt: "Hi" });

			expect(await result.text).toBe("Hello stream");
			expect(seen).toHaveLength(1);
			expect(seen[0].content).toEqual([{ type: "text", text: "Hello stream" }]);
			expect(seen[0].usage).toEqual(usage);
			expect((await result.providerMetadata)?.custom).toEqual({ streamModified: true });
		});
	});

	describe("client aborts", () => {
		it("closes the upstream request when the client aborts before the gateway answers", async () => {
			upstream.respondWith(respondNever);
			const gateway = await startProxy();
			const controller = new AbortController();
			const received = upstream.nextRequest();

			const generation = generateText({
				model: gateway(MODEL),
				prompt: "Hi",
				abortSignal: controller.signal,
			});
			await received;
			controller.abort();

			await expect(generation).rejects.toThrow();
			expect(await upstream.requests[0].closedEarly).toBe(true);
		});

		it("closes the upstream stream when the client aborts mid-stream", async () => {
			upstream.respondWith(respondStreamThenHang);
			const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => response);
			// Without the abort signal the only path upstream is cancelling the response body.
			const gateway = await startProxy({ afterResponse }, { forwardAbortSignal: false });
			const controller = new AbortController();

			const result = streamText({
				model: gateway(MODEL),
				prompt: "Hi",
				abortSignal: controller.signal,
				onError: () => {},
			});
			for await (const delta of result.textStream) {
				expect(delta).toBe("Hello ");
				controller.abort();
			}

			expect(await upstream.requests[0].closedEarly).toBe(true);
			expect(afterResponse).not.toHaveBeenCalled();
		});
	});
});
