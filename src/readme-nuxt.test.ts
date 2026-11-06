/**
 * The README's Nuxt server route, run as written inside a real h3 v1 app between a real
 * `@ai-sdk/gateway` client and a fake gateway. The route is mounted at `/api/ai/**:path`, the
 * pattern Nitro gives `server/api/ai/[...path].ts`, and served both through a Node listener (the
 * default `node-server` preset) and through h3's web handler (the edge presets). No gateway key or
 * network is needed.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import ts from "@typescript/typescript6";
import { generateText, streamText } from "ai";
import {
	createApp,
	createRouter,
	defineEventHandler,
	type EventHandler,
	getRouterParams,
	toNodeListener,
	toWebHandler,
	toWebRequest,
} from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "nuxt-route-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const firstParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
];
const lastParts: LanguageModelV4StreamPart[] = [
	{ type: "text-delta", id: "t1", delta: "Nuxt" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const sse = (parts: LanguageModelV4StreamPart[]) =>
	new TextEncoder().encode(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""));

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(): string {
	const start = readme.indexOf("\n### Nuxt\n");
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error("README has no Nuxt sample");
	return code;
}

// Runs the sample as written, with Nuxt's h3 auto-imports in scope and the package import bound to a
// proxy that calls the fake gateway.
function readmeHandler(proxyOptions: CreateGatewayProxyOptions): EventHandler {
	const script = ts.transpileModule(readmeSample(), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const exports: { default?: EventHandler } = {};
	const require = (name: string) => {
		if (name !== "ai-gateway-proxy") throw new Error(`unexpected import ${name}`);
		return {
			createGatewayProxy: (options: CreateGatewayProxyOptions = {}) =>
				createGatewayProxy({ ...options, ...proxyOptions }),
		};
	};
	new Function(
		"exports",
		"require",
		"defineEventHandler",
		"toWebRequest",
		"getRouterParams",
		script,
	)(exports, require, defineEventHandler, toWebRequest, getRouterParams);
	if (typeof exports.default !== "function")
		throw new Error("README Nuxt sample exports no handler");
	return exports.default;
}

type Serve = (handler: EventHandler) => Promise<{
	baseURL: string;
	fetch: typeof globalThis.fetch;
	close: () => Promise<void>;
}>;

function nuxtApp(handler: EventHandler) {
	const app = createApp();
	app.use(createRouter().use("/api/ai/**:path", handler));
	return app;
}

const transports: { transport: string; serve: Serve }[] = [
	{
		transport: "Node listener",
		serve: async (handler) => {
			const server: Server = createServer(toNodeListener(nuxtApp(handler)));
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const { port } = server.address() as AddressInfo;
			return {
				baseURL: `http://127.0.0.1:${port}/api/ai`,
				fetch: globalThis.fetch,
				close: () => new Promise((resolve) => server.close(() => resolve())),
			};
		},
	},
	{
		transport: "web handler",
		serve: async (handler) => {
			const webHandler = toWebHandler(nuxtApp(handler));
			return {
				baseURL: "https://app.test/api/ai",
				fetch: async (input, init) => webHandler(new Request(input, init)),
				close: async () => {},
			};
		},
	},
];

describe.each(transports)("README Nuxt route through h3's $transport", ({ serve }) => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;
	let close: (() => Promise<void>) | undefined;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await close?.();
		close = undefined;
	});

	async function route(options: Omit<CreateGatewayProxyOptions, "fetch" | "segmentsParam"> = {}) {
		const served = await serve(
			readmeHandler({
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
			}),
		);
		close = served.close;
		return served;
	}

	async function client(options: Omit<CreateGatewayProxyOptions, "fetch" | "segmentsParam"> = {}) {
		const { baseURL, fetch } = await route(options);
		return createGateway({ baseURL, apiKey: "unused", fetch });
	}

	it("forwards a generateText call to the gateway path after /api/ai with the proxy's key", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello Nuxt" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = await client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello Nuxt");
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			url: `${GATEWAY_URL}/language-model`,
			method: "POST",
			authorization: `Bearer ${GATEWAY_KEY}`,
		});
		expect(JSON.parse(recorded[0].body).prompt).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hi" }] },
		]);
	});

	it("streams each event to the client as the gateway sends it", async () => {
		// The gateway holds the rest of the stream until the client has read the first delta, so a
		// route that buffered the response would never finish.
		let release = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		respond = () =>
			new Response(
				new ReadableStream({
					async start(controller) {
						controller.enqueue(sse(firstParts));
						await released;
						controller.enqueue(sse(lastParts));
						controller.close();
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => response);
		const gateway = await client({ afterResponse });

		const deltas: string[] = [];
		for await (const delta of streamText({ model: gateway(MODEL), prompt: "Hi" }).textStream) {
			deltas.push(delta);
			release();
		}

		expect(deltas.join("")).toBe("Hello Nuxt");
		expect(afterResponse).toHaveBeenCalledOnce();
		expect(afterResponse.mock.calls[0][0].response.usage).toEqual(usage);
	});

	it("forwards a GET such as getAvailableModels without a body", async () => {
		respond = () => Response.json({ models: [] });
		const gateway = await client();

		await gateway.getAvailableModels();

		expect(recorded).toEqual([
			{
				url: `${GATEWAY_URL}/config`,
				method: "GET",
				authorization: `Bearer ${GATEWAY_KEY}`,
				body: "",
			},
		]);
	});

	it("keeps the slashes and query of a path with more than one segment", async () => {
		respond = () => Response.json({ status: "completed" });
		const { baseURL, fetch } = await route();

		const response = await fetch(`${baseURL}/batch/status?batchId=b1`);

		expect(response.status).toBe(200);
		expect(recorded.map(({ url, method }) => ({ url, method }))).toEqual([
			{ url: `${GATEWAY_URL}/batch/status?batchId=b1`, method: "GET" },
		]);
	});
});
