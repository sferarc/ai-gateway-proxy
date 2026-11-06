/**
 * The README's SvelteKit, Astro, React Router and TanStack Start routes, run as written between a
 * real `@ai-sdk/gateway` client and a fake gateway, called as those frameworks call a rest or splat
 * route: the rest of the path is one string param. No gateway key, server or network is needed.
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
const GATEWAY_KEY = "rest-route-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";
const ROUTE_PREFIX = "/api/ai/";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "route" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

type RouteEvent = { request: Request; params: Record<string, string> };
type RouteHandler = (event: RouteEvent) => Promise<Response>;
type RouteModule = Record<string, unknown>;
type FileRoute = { path: string; options: { server: { handlers: RouteModule } } };

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(heading: string): string {
	const start = readme.indexOf(`\n### ${heading}\n`);
	const end = readme.indexOf("\n### ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error(`README has no ${heading} sample`);
	return code;
}

// Runs the sample as written, with the package import bound to a proxy that calls the fake gateway.
function readmeRoute(heading: string, proxyOptions: CreateGatewayProxyOptions) {
	const script = ts.transpileModule(readmeSample(heading), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const exports: Record<string, unknown> = {};
	const require = (name: string) => {
		// Stands in for TanStack Router, keeping the path and options the route file passes.
		if (name === "@tanstack/react-router") {
			return {
				createFileRoute:
					(path: string) =>
					(options: FileRoute["options"]): FileRoute => ({ path, options }),
			};
		}
		if (name !== "ai-gateway-proxy") throw new Error(`unexpected import ${name}`);
		return {
			createGatewayProxy: (options: CreateGatewayProxyOptions = {}) =>
				createGatewayProxy({ ...options, ...proxyOptions }),
		};
	};
	new Function("exports", "require", script)(exports, require);
	return exports;
}

const routes: {
	framework: string;
	param: string;
	handlers?: (exports: RouteModule) => RouteModule;
	handler: (method: string) => string;
}[] = [
	{ framework: "SvelteKit", param: "path", handler: () => "fallback" },
	{ framework: "Astro", param: "path", handler: () => "ALL" },
	// React Router sends GET and HEAD to loader and every other method to action.
	{
		framework: "React Router",
		param: "*",
		handler: (method) => (method === "GET" || method === "HEAD" ? "loader" : "action"),
	},
	// TanStack Start calls the handler named after the method in the route's server.handlers.
	{
		framework: "TanStack Start",
		param: "_splat",
		handlers: (exports) => {
			const fileRoute = exports.Route as FileRoute;
			expect(fileRoute.path).toBe("/api/ai/$");
			return fileRoute.options.server.handlers;
		},
		handler: (method) => method,
	},
];

describe.each(routes)("README $framework route", ({ framework, param, handlers, handler }) => {
	let recorded: { url: string; method: string; authorization: string | null; body: string }[];
	let respond: () => Response;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function route(options: Omit<CreateGatewayProxyOptions, "fetch" | "segmentsParam"> = {}) {
		const routeModule = readmeRoute(framework, {
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
		const exports = handlers ? handlers(routeModule) : routeModule;
		for (const method of ["GET", "POST"]) {
			expect(exports[handler(method)]).toBeTypeOf("function");
		}
		const routeHandler: RouteHandler = (event) =>
			(exports[handler(event.request.method)] as RouteHandler)(event);
		return routeHandler;
	}

	// The framework's side: the rest segment after the route's directory, slashes kept, undecoded.
	function call(routeHandler: RouteHandler, request: Request) {
		const path = new URL(request.url).pathname.slice(ROUTE_PREFIX.length);
		return routeHandler({ request, params: { [param]: path } });
	}

	function client(options: Omit<CreateGatewayProxyOptions, "fetch" | "segmentsParam"> = {}) {
		const routeHandler = route(options);
		return createGateway({
			baseURL: "https://app.test/api/ai",
			apiKey: "unused",
			fetch: async (input, init) => call(routeHandler, new Request(input, init)),
		});
	}

	it("forwards a generateText call to the gateway path after /api/ai with the proxy's key", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: `Hello ${framework}` }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe(`Hello ${framework}`);
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

		expect(await result.text).toBe("Hello route");
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

	it("keeps the slashes of a rest segment with more than one part", async () => {
		respond = () => Response.json({ status: "completed" });
		const routeHandler = route();

		const response = await call(
			routeHandler,
			new Request("https://app.test/api/ai/batch/status?batchId=b1"),
		);

		expect(response.status).toBe(200);
		expect(recorded.map(({ url, method }) => ({ url, method }))).toEqual([
			{ url: `${GATEWAY_URL}/batch/status?batchId=b1`, method: "GET" },
		]);
	});
});
