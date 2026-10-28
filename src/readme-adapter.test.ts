/**
 * The README's Express adapter, served with `createServer(handle)` as the README allows, between a
 * real `@ai-sdk/gateway` client and a local fake gateway. No gateway key or network is needed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse, IncompleteStream } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "adapter-dummy-gateway-key";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "adapter" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

function sse(parts: LanguageModelV4StreamPart[]): string {
	return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
}

// The Express example in README.md, with the proxy passed in and braces for lint; change both together.
function readmeHandle(proxy: ReturnType<typeof createGatewayProxy>) {
	return async function handle(req: IncomingMessage, res: ServerResponse) {
		const controller = new AbortController();
		res.on("close", () => {
			if (!res.writableFinished) controller.abort();
		});

		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers)) {
			if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
		}

		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const request = new Request(new URL(req.url ?? "/", `http://${req.headers.host}`), {
			method: req.method,
			headers,
			body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
			duplex: "half",
			signal: controller.signal,
		} as RequestInit);

		const response = await proxy(request);

		res.statusCode = response.status;
		response.headers.forEach((value, name) => {
			res.setHeader(name, value);
		});
		if (!response.body) {
			res.end();
			return;
		}
		// Rejects when the client disconnects mid-stream; the abort above has already cancelled upstream.
		await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), res).catch(
			() => {},
		);
	};
}

type Recorded = { method?: string; path?: string; body: string; closedEarly: Promise<boolean> };

function listen(server: ReturnType<typeof createServer>): Promise<string> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
		),
	);
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve) => server.close(() => resolve()));
}

describe("README Express adapter", () => {
	let respond: (res: ServerResponse) => void;
	let recorded: Recorded[];
	let gatewayServer: ReturnType<typeof createServer>;
	let adapterServer: ReturnType<typeof createServer> | undefined;
	let gatewayUrl: string;
	let errorSpy: MockInstance<typeof console.error>;

	beforeEach(async () => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		recorded = [];
		gatewayServer = createServer(async (req, res) => {
			const closedEarly = new Promise<boolean>((resolve) => {
				res.on("close", () => resolve(!res.writableFinished));
			});
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk);
			}
			recorded.push({
				method: req.method,
				path: req.url,
				body: Buffer.concat(chunks).toString(),
				closedEarly,
			});
			respond(res);
		});
		gatewayUrl = await listen(gatewayServer);
	});

	afterEach(async () => {
		if (adapterServer) {
			await close(adapterServer);
			adapterServer = undefined;
		}
		await close(gatewayServer);
		errorSpy.mockRestore();
		vi.unstubAllEnvs();
	});

	async function startAdapter(options: CreateGatewayProxyOptions = {}) {
		const proxy = createGatewayProxy({
			...options,
			baseUrl: `${gatewayUrl}/v4/ai`,
			extractPath: (request) => new URL(request.url).pathname.replace(/^\/api\/ai\//, ""),
		});
		adapterServer = createServer(readmeHandle(proxy));
		const url = await listen(adapterServer);
		return createGateway({ baseURL: `${url}/api/ai`, apiKey: "unused" });
	}

	it("streams the request body to the gateway and returns a generated text", async () => {
		respond = (res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					content: [{ type: "text", text: "Hello adapter" }],
					finishReason: { unified: "stop", raw: "stop" },
					usage,
					warnings: [],
				}),
			);
		};
		const gateway = await startAdapter();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello adapter");
		expect(recorded).toHaveLength(1);
		expect(recorded[0].method).toBe("POST");
		expect(recorded[0].path).toBe("/v4/ai/language-model");
		expect(JSON.parse(recorded[0].body).prompt).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hi" }] },
		]);
	});

	it("pipes a stream to the client and gives afterResponse the aggregated result", async () => {
		respond = (res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(sse(streamParts));
		};
		const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => response);
		const gateway = await startAdapter({ afterResponse });

		const result = streamText({ model: gateway(MODEL), prompt: "Hi" });

		expect(await result.text).toBe("Hello adapter");
		expect(afterResponse).toHaveBeenCalledOnce();
		expect(afterResponse.mock.calls[0][0].response.usage).toEqual(usage);
	});

	it("reports a client disconnect mid-stream to afterResponse as a cancel, not an upstream failure", async () => {
		respond = (res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(sse(streamParts.slice(0, 3)));
		};
		const afterResponse = vi.fn(
			({ response }: { response: GatewayResponse; incomplete?: IncompleteStream }) => response,
		);
		const gateway = await startAdapter({ afterResponse });
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

		expect(await recorded[0].closedEarly).toBe(true);
		await vi.waitFor(() => expect(afterResponse).toHaveBeenCalledOnce());
		const context = afterResponse.mock.calls[0][0];
		expect(context.incomplete?.reason).toBe("cancelled");
		expect(context.response.finishReason.unified).toBe("other");
		expect(context.response.content).toEqual([{ type: "text", text: "Hello " }]);
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
