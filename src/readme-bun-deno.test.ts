/**
 * The README's Bun and Deno servers, run as written with `Bun.serve` and `Deno.serve` stubbed, between
 * a real `@ai-sdk/gateway` client and a fake gateway passed as the proxy's `fetch`. Each stub calls
 * the handler with the runtime's second argument, as the runtime does. No gateway key, server or
 * network is needed.
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
const GATEWAY_KEY = "bun-deno-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "runtime" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(heading: string): string {
	const start = readme.indexOf(`\n### ${heading}\n`);
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error(`README has no ${heading} sample`);
	return code;
}

type Handler = (request: Request) => Promise<Response>;
type Options = Omit<CreateGatewayProxyOptions, "extractPath">;

function run(
	heading: string,
	packageName: string,
	globals: Record<string, unknown>,
	options: Options,
) {
	const script = ts.transpileModule(readmeSample(heading), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const proxyModule = {
		createGatewayProxy: (sampleOptions: CreateGatewayProxyOptions = {}) =>
			createGatewayProxy({ ...sampleOptions, ...options }),
	};
	const require = (name: string) => {
		if (name === packageName) return proxyModule;
		throw new Error(`unexpected import ${name}`);
	};
	new Function("exports", "require", ...Object.keys(globals), script)(
		{},
		require,
		...Object.values(globals),
	);
}

type BunRoute = (request: Request, server: unknown) => Response | Promise<Response>;

// Bun's routing for the sample's two entries: the wildcard route, else the fetch fallback.
function bunServer(options: Options): Handler {
	let served: { routes: Record<string, BunRoute>; fetch: BunRoute } | undefined;
	const server = { port: 3000, timeout: () => {} };
	run(
		"Bun",
		"ai-gateway-proxy",
		{ Bun: { serve: (config: typeof served) => (served = config) } },
		options,
	);
	if (!served) throw new Error("README Bun sample never calls Bun.serve");
	const { routes, fetch } = served;
	expect(Object.keys(routes)).toEqual(["/api/ai/*"]);
	return async (request) =>
		new URL(request.url).pathname.startsWith("/api/ai/")
			? routes["/api/ai/*"](request, server)
			: fetch(request, server);
}

function denoServer(options: Options): Handler {
	let served: ((request: Request, info: unknown) => Response | Promise<Response>) | undefined;
	const info = { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 50000 } };
	run(
		"Deno",
		"npm:ai-gateway-proxy",
		{ Deno: { serve: (handler: typeof served) => (served = handler) } },
		options,
	);
	const handler = served;
	if (!handler) throw new Error("README Deno sample never calls Deno.serve");
	return async (request) => handler(request, info);
}

describe.each([
	{ runtime: "Bun", server: bunServer },
	{ runtime: "Deno", server: denoServer },
])("README $runtime server", ({ server }) => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function serve(options: Omit<Options, "fetch"> = {}): Handler {
		return server({
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
	}

	function client(options: Omit<Options, "fetch"> = {}) {
		const handler = serve(options);
		return createGateway({
			baseURL: "https://app.test/api/ai",
			apiKey: "unused",
			fetch: async (input, init) => handler(new Request(input, init)),
		});
	}

	it("forwards a generateText call with its body to the gateway path after /api/ai", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello runtime" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello runtime");
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

		expect(await result.text).toBe("Hello runtime");
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

	it("answers other paths with 404 without calling the gateway", async () => {
		const handler = serve();

		const response = await handler(
			new Request("https://app.test/api/other", { method: "POST", body: "{}" }),
		);

		expect(response.status).toBe(404);
		expect(recorded).toEqual([]);
	});
});
