/**
 * The README's Netlify Function, run as written between a real `@ai-sdk/gateway` client and a fake
 * gateway passed as the proxy's `fetch`. The test routes by the sample's `config.path` with the
 * runtime's `URLPattern`, as Netlify does, and calls the default export with a Netlify-like
 * `Context` as its second argument. No gateway key, Netlify runtime or network is needed.
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
const GATEWAY_KEY = "netlify-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "netlify" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(): string {
	const start = readme.indexOf("\n### Netlify Functions\n");
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error("README has no Netlify Functions sample");
	return code;
}

type Options = Omit<CreateGatewayProxyOptions, "extractPath">;
type NetlifyFunction = (request: Request, context: unknown) => Response | Promise<Response>;
type NetlifyModule = { default?: NetlifyFunction; config?: { path?: unknown } };
type Pattern = { test: (input: string) => boolean };
const URLPatternCtor = (globalThis as { URLPattern?: new (init: { pathname: string }) => Pattern })
	.URLPattern;

function load(options: Options): Required<NetlifyModule> {
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
	const exports: NetlifyModule = {};
	new Function("exports", "require", script)(exports, require);
	if (typeof exports.default !== "function" || !exports.config)
		throw new Error("README Netlify Functions sample exports no handler or config");
	return exports as Required<NetlifyModule>;
}

// Named groups only, as Netlify exposes them; the wildcard is unnamed, so params is empty.
const context = {
	params: {},
	requestId: "01NETLIFYREQUEST",
	ip: "127.0.0.1",
	geo: {},
	site: { id: "site", name: "site", url: "https://app.test" },
};

describe("README Netlify Function", () => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function serve(options: Omit<Options, "fetch"> = {}) {
		const fn = load({
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
		return async (request: Request) => fn.default(request, context);
	}

	function client(options: Omit<Options, "fetch"> = {}) {
		const handler = serve(options);
		return createGateway({
			baseURL: "https://app.test/api/ai",
			apiKey: "unused",
			fetch: async (input, init) => handler(new Request(input, init)),
		});
	}

	it("routes /api/ai/ and everything under it, and nothing else", () => {
		const { config } = load({});
		expect(config).toEqual({ path: "/api/ai/*" });
		if (!URLPatternCtor) throw new Error("this Node has no URLPattern");
		const pattern = new URLPatternCtor({ pathname: config.path as string });

		expect(pattern.test("https://app.test/api/ai/language-model")).toBe(true);
		expect(pattern.test("https://app.test/api/ai/batch/status?batchId=b1")).toBe(true);
		expect(pattern.test("https://app.test/api/other")).toBe(false);
		expect(pattern.test("https://app.test/api/aix/config")).toBe(false);
	});

	it("forwards a generateText call with its body and the key from process.env", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello netlify" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello netlify");
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

	it("streams to the client and gives afterResponse the aggregated result", async () => {
		respond = () =>
			new Response(streamParts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), {
				headers: { "content-type": "text/event-stream" },
			});
		const afterResponse = vi.fn(({ response }: { response: GatewayResponse }) => response);
		const gateway = client({ afterResponse });

		const result = streamText({ model: gateway(MODEL), prompt: "Hi" });

		expect(await result.text).toBe("Hello netlify");
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
				authorization: `Bearer ${GATEWAY_KEY}`,
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
});
