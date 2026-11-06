/**
 * The README's Cloudflare Worker, run as written between a real `@ai-sdk/gateway` client and a fake
 * gateway passed as the proxy's `fetch`. The test calls the Worker's `fetch` with an `env` and an
 * execution context, as the Workers runtime does, while `process.env` holds a different key that
 * must never reach the gateway. No gateway key, Worker runtime or network is needed.
 */

import { readFileSync } from "node:fs";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import ts from "@typescript/typescript6";
import { generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

const MODEL = "test/fake-model";
const WORKER_KEY = "worker-secret-dummy-gateway-key";
const PROCESS_KEY = "process-env-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "worker" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(): string {
	const start = readme.indexOf("\n### Cloudflare Workers\n");
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error("README has no Cloudflare Workers sample");
	return code;
}

type Options = Omit<CreateGatewayProxyOptions, "extractPath" | "apiKey">;
type Env = { AI_GATEWAY_API_KEY?: string };
type Worker = { fetch: (request: Request, env: Env, ctx: unknown) => Response | Promise<Response> };

// The sample's options are spread last, so its own apiKey and extractPath are the ones used.
function worker(options: Options): Worker {
	const script = ts.transpileModule(readmeSample(), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const proxyModule = {
		createGatewayProxy: (sampleOptions: CreateGatewayProxyOptions = {}) =>
			createGatewayProxy({ ...options, ...sampleOptions }),
	};
	const require = (name: string) => {
		if (name === "ai-gateway-proxy") return proxyModule;
		throw new Error(`unexpected import ${name}`);
	};
	const exports: { default?: Worker } = {};
	new Function("exports", "require", script)(exports, require);
	if (typeof exports.default?.fetch !== "function")
		throw new Error("README Cloudflare Workers sample exports no fetch handler");
	return exports.default;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

describe("README Cloudflare Worker", () => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", PROCESS_KEY);
		recorded = [];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function serve(options: Options = {}, env: Env = { AI_GATEWAY_API_KEY: WORKER_KEY }) {
		const { fetch } = worker({
			...options,
			baseUrl: GATEWAY_URL,
			fetch: async (input, init) => {
				const request = new Request(input, init);
				recorded.push({
					url: request.url,
					method: request.method,
					authorization: request.headers.get("authorization"),
					body: await request.text(),
				});
				return respond();
			},
		});
		return async (request: Request) => fetch(request, env, ctx);
	}

	function client(options: Options = {}) {
		const handler = serve(options);
		return createGateway({
			baseURL: "https://app.test/api/ai",
			apiKey: "unused",
			fetch: async (input, init) => handler(new Request(input, init)),
		});
	}

	it("forwards a generateText call with the key from env, not process.env", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello worker" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello worker");
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			url: `${GATEWAY_URL}/language-model`,
			method: "POST",
			authorization: `Bearer ${WORKER_KEY}`,
		});
		expect(JSON.parse(recorded[0].body).prompt).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hi" }] },
		]);
	});

	it("streams to the client and gives afterResponse the aggregated result", async () => {
		respond = () =>
			new Response(streamParts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), {
				headers: { "content-type": "text/event-stream" },
			});
		const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => response);
		const gateway = client({ afterResponse });

		const result = streamText({ model: gateway(MODEL), prompt: "Hi" });

		expect(await result.text).toBe("Hello worker");
		expect(afterResponse).toHaveBeenCalledOnce();
		expect(afterResponse.mock.calls[0][0].response.usage).toEqual(usage);
	});

	it("forwards a GET such as getAvailableModels without a body", async () => {
		respond = () => Response.json({ models: [] });
		const gateway = client();

		await gateway.getAvailableModels();

		expect(recorded).toEqual([
			{
				url: `${GATEWAY_URL}/config`,
				method: "GET",
				authorization: `Bearer ${WORKER_KEY}`,
				body: "",
			},
		]);
	});

	it("keeps the slashes and query of a path with more than one segment", async () => {
		respond = () => Response.json({ status: "completed" });
		const handler = serve();

		const response = await handler(new Request("https://app.test/api/ai/batch/status?batchId=b1"));

		expect(response.status).toBe(200);
		expect(recorded.map(({ url, method }) => ({ url, method }))).toEqual([
			{ url: `${GATEWAY_URL}/batch/status?batchId=b1`, method: "GET" },
		]);
	});

	it("answers other paths with 404 without calling the gateway", async () => {
		const handler = serve();

		const response = await handler(
			new Request("https://app.test/api/other", { method: "POST", body: "{}" }),
		);

		expect(response.status).toBe(404);
		expect(recorded).toEqual([]);
	});

	it("answers 500 api_key_missing without a secret instead of using process.env", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = serve({}, {});

		const response = await handler(
			new Request("https://app.test/api/ai/config", { method: "GET" }),
		);

		expect(response.status).toBe(500);
		expect((await response.json()).error.code).toBe("api_key_missing");
		expect(recorded).toEqual([]);
		consoleError.mockRestore();
	});
});
