/**
 * Keyless tests that pin the current behavior for the calls that are not language model calls:
 * an `@ai-sdk/gateway` client calls the proxy over HTTP, and a local fake gateway records what
 * reaches it. The hooks would change or break these calls if they ran, so the tests fail if one does.
 */

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProxyServer } from "./test-server";

const GATEWAY_KEY = "non-lm-dummy-gateway-key";

type Recorded = {
	method: string | undefined;
	path: string | undefined;
	headers: IncomingMessage["headers"];
	body: unknown;
};

type Reply = { contentType: string; body: string };

async function startFakeGateway(reply: Reply) {
	const requests: Recorded[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		requests.push({
			method: req.method,
			path: req.url,
			headers: req.headers,
			body: JSON.parse(Buffer.concat(chunks).toString()),
		});
		res.writeHead(200, { "content-type": reply.contentType });
		res.end(reply.body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1/ai`,
		requests,
		close() {
			server.closeAllConnections();
			return new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

describe("non-language-model calls through the proxy to a fake gateway", () => {
	let upstream: Awaited<ReturnType<typeof startFakeGateway>> | undefined;
	let closeProxy: (() => Promise<void>) | undefined;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
	});

	afterEach(async () => {
		await closeProxy?.();
		closeProxy = undefined;
		await upstream?.close();
		upstream = undefined;
		vi.unstubAllEnvs();
	});

	async function setup(reply: Reply) {
		upstream = await startFakeGateway(reply);
		// Hooks written for language model calls; each would change or break these calls if it ran.
		const beforeRequest = vi.fn(({ request }) => ({ ...request, temperature: 0 }));
		const afterResponse = vi.fn(() => {
			throw new Error("afterResponse must not run");
		});
		const onError = vi.fn();
		const { gateway, close } = await startProxyServer({
			proxyOptions: { baseUrl: upstream.baseUrl, beforeRequest, afterResponse, onError },
		});
		closeProxy = close;
		return { gateway, upstream, hooks: { beforeRequest, afterResponse, onError } };
	}

	function expectAuthApplied(received: Recorded, path: string) {
		expect(received.method).toBe("POST");
		expect(received.path).toBe(path);
		expect(received.headers.authorization).toBe(`Bearer ${GATEWAY_KEY}`);
		expect(received.headers["ai-gateway-auth-method"]).toBe("api-key");
	}

	function expectNoHookRan(hooks: Awaited<ReturnType<typeof setup>>["hooks"]) {
		expect(hooks.beforeRequest).not.toHaveBeenCalled();
		expect(hooks.afterResponse).not.toHaveBeenCalled();
		expect(hooks.onError).not.toHaveBeenCalled();
	}

	it("passes an embedding call through unchanged", async () => {
		const { gateway, upstream, hooks } = await setup({
			contentType: "application/json",
			body: JSON.stringify({ embeddings: [[0.1, 0.2]], usage: { tokens: 2 } }),
		});

		const result = await gateway.embeddingModel("openai/text-embedding-3-small").doEmbed({
			values: ["hello"],
		});

		expect(result.embeddings).toEqual([[0.1, 0.2]]);
		expect(result.usage).toEqual({ tokens: 2 });
		expect(upstream.requests).toHaveLength(1);
		const [received] = upstream.requests;
		expectAuthApplied(received, "/v1/ai/embedding-model");
		expect(received.headers["ai-model-id"]).toBe("openai/text-embedding-3-small");
		expect(received.body).toEqual({ values: ["hello"] });
		expectNoHookRan(hooks);
	});

	it("passes an image call through unchanged", async () => {
		const { gateway, upstream, hooks } = await setup({
			contentType: "application/json",
			body: JSON.stringify({ images: ["AAAA"], usage: { inputTokens: 3 } }),
		});

		const result = await gateway.imageModel("openai/gpt-image-1").doGenerate({
			prompt: "a cat",
			n: 1,
			size: undefined,
			aspectRatio: undefined,
			seed: undefined,
			files: undefined,
			mask: undefined,
			providerOptions: {},
		});

		expect(result.images).toEqual(["AAAA"]);
		expect(upstream.requests).toHaveLength(1);
		const [received] = upstream.requests;
		expectAuthApplied(received, "/v1/ai/image-model");
		expect(received.headers["ai-model-id"]).toBe("openai/gpt-image-1");
		expect(received.body).toEqual({ prompt: "a cat", n: 1, providerOptions: {} });
		expectNoHookRan(hooks);
	});

	it("passes a video call through unchanged", async () => {
		const video = { type: "base64", data: "AAAA", mediaType: "video/mp4" };
		const { gateway, upstream, hooks } = await setup({
			contentType: "text/event-stream",
			body: `data: ${JSON.stringify({ type: "result", videos: [video] })}\n\n`,
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
		expect(upstream.requests).toHaveLength(1);
		const [received] = upstream.requests;
		expectAuthApplied(received, "/v1/ai/video-model");
		expect(received.headers["ai-model-id"]).toBe("google/veo-3.0-generate-001");
		expect(received.headers.accept).toBe("text/event-stream");
		expect(received.body).toEqual({ prompt: "a cat", n: 1, providerOptions: {} });
		expectNoHookRan(hooks);
	});

	it("passes a batch start through unchanged", async () => {
		const { gateway, upstream, hooks } = await setup({
			contentType: "application/json",
			body: JSON.stringify({ batchId: "batch_1", status: "pending" }),
		});
		const requests = [
			{
				id: "r1",
				type: "text" as const,
				modelId: "openai/gpt-5",
				options: {
					prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
				},
			},
		];

		const result = await gateway.experimental_batch().doStartBatch({
			requests,
			providerOptions: undefined,
			headers: { "idempotency-key": "batch-42" },
		});

		expect(result.batchId).toBe("batch_1");
		expect(result.status).toBe("pending");
		expect(upstream.requests).toHaveLength(1);
		const [received] = upstream.requests;
		expectAuthApplied(received, "/v1/ai/batch/start");
		expect(received.headers["ai-model-id"]).toBe("openai/gpt-5");
		expect(received.headers["idempotency-key"]).toBe("batch-42");
		expect(received.body).toEqual({ requests });
		expectNoHookRan(hooks);
	});
});
