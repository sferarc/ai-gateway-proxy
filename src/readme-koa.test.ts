/**
 * The README's Koa middleware, run as written inside a real Koa app with the README Express `handle`
 * as `./gateway-handle`, between a real `@ai-sdk/gateway` client and a fake gateway. No gateway key
 * or network is needed.
 */

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import ts from "@typescript/typescript6";
import { generateText, streamText } from "ai";
import Koa, { type Middleware } from "koa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "koa-route-dummy-gateway-key";
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
	{ type: "text-delta", id: "t1", delta: "Koa" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const sse = (parts: LanguageModelV4StreamPart[]) =>
	new TextEncoder().encode(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""));

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const nodeRequire = createRequire(import.meta.url);

function readmeSample(heading: string): string {
	const start = readme.indexOf(`\n### ${heading}\n`);
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error(`README has no ${heading} sample`);
	return code;
}

function run(source: string, modules: Record<string, unknown>): Record<string, unknown> {
	const script = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const exports: Record<string, unknown> = {};
	const require = (name: string) => {
		if (name in modules) return modules[name];
		if (name.startsWith("node:")) return nodeRequire(name);
		throw new Error(`unexpected import ${name}`);
	};
	new Function("exports", "require", script)(exports, require);
	return exports;
}

type Handle = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// The Express sample as written, with its Express app stubbed out, so its `handle` is the module the
// Koa sample imports.
function readmeHandle(proxyOptions: CreateGatewayProxyOptions): Handle {
	const exports = run(`${readmeSample("Express")}\nexports.handle = handle;\n`, {
		express: { __esModule: true, default: () => ({ all: () => {}, listen: () => {} }) },
		"ai-gateway-proxy": {
			createGatewayProxy: (options: CreateGatewayProxyOptions = {}) =>
				createGatewayProxy({ ...options, ...proxyOptions }),
		},
	});
	return exports.handle as Handle;
}

function readmeRoute(handle: Handle): Middleware {
	const exports = run(readmeSample("Koa"), { "./gateway-handle": { handle } });
	if (typeof exports.gatewayRoute !== "function")
		throw new Error("README Koa sample exports no gatewayRoute");
	return exports.gatewayRoute as Middleware;
}

describe("README Koa route", () => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;
	let server: Server | undefined;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		server?.closeAllConnections();
		await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
		server = undefined;
	});

	async function serve(options: Omit<CreateGatewayProxyOptions, "fetch" | "extractPath"> = {}) {
		const handle = readmeHandle({
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
		const app = new Koa();
		app.use(readmeRoute(handle));
		app.use((ctx) => {
			ctx.body = { reached: ctx.path };
		});
		const listening = createServer(app.callback());
		server = listening;
		await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
		return `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
	}

	async function client(options: Omit<CreateGatewayProxyOptions, "fetch" | "extractPath"> = {}) {
		return createGateway({ baseURL: `${await serve(options)}/api/ai`, apiKey: "unused" });
	}

	it("forwards a generateText call with its body to the gateway path after /api/ai", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello Koa" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = await client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello Koa");
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

		expect(deltas.join("")).toBe("Hello Koa");
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
		const address = await serve();

		const response = await fetch(`${address}/api/ai/batch/status?batchId=b1`);

		expect(response.status).toBe(200);
		expect(recorded.map(({ url, method }) => ({ url, method }))).toEqual([
			{ url: `${GATEWAY_URL}/batch/status?batchId=b1`, method: "GET" },
		]);
	});

	it("passes other paths on to the next middleware", async () => {
		const address = await serve();

		const response = await fetch(`${address}/api/other`, { method: "POST", body: "{}" });

		expect(await response.json()).toEqual({ reached: "/api/other" });
		expect(recorded).toEqual([]);
	});
});
