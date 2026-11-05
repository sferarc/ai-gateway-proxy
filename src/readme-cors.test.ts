/**
 * The README's "Calling from another origin" route, run as written between a real `@ai-sdk/gateway`
 * client and a fake gateway, through a fetch that applies the browser's CORS checks.
 * No gateway key, server or network is needed.
 */

import { readFileSync } from "node:fs";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import ts from "@typescript/typescript6";
import { generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "cors-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";
const ROUTE_URL = "https://api.example.com/api/ai";
const ALLOWED_ORIGIN = "https://app.example.com";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "cross-origin" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

type Context = { params: Promise<{ segments: string[] }> };
type Handler = (request: Request, context: Context) => Promise<Response>;
type Route = { OPTIONS: (request: Request) => Response } & Record<string, Handler>;

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function readmeSample(): string {
	const start = readme.indexOf("\n### Calling from another origin\n");
	const end = readme.indexOf("\n## ", start + 1);
	const code = readme.slice(start, end).match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
	if (start === -1 || !code) throw new Error("README has no Calling from another origin sample");
	return code;
}

// Runs the sample as written, with the package import bound to a proxy that calls the fake gateway.
function readmeRoute(proxyOptions: CreateGatewayProxyOptions): Route {
	const script = ts.transpileModule(readmeSample(), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const exports: Record<string, unknown> = {};
	const require = (name: string) => {
		if (name !== "ai-gateway-proxy") throw new Error(`unexpected import ${name}`);
		return {
			createGatewayProxy: (options: CreateGatewayProxyOptions = {}) =>
				createGatewayProxy({ ...options, ...proxyOptions }),
		};
	};
	new Function("exports", "require", script)(exports, require);
	return exports as Route;
}

// What a browser lets through without CORS approval, per the Fetch standard.
const SAFELISTED_REQUEST_HEADERS = new Set(["accept", "accept-language", "content-language"]);
const SAFELISTED_RESPONSE_HEADERS = new Set([
	"cache-control",
	"content-language",
	"content-length",
	"content-type",
	"expires",
	"last-modified",
	"pragma",
]);

function list(value: string | null): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

type Preflight = { method: string; requested: string[]; status: number };

// A page on `origin` calling the route: preflight, origin check, and only exposed headers readable.
// A "*" in allow-headers is not honoured, since it never covers authorization.
function browserFetch(route: Route, origin: string, preflights: Preflight[]) {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const context = {
			params: Promise.resolve({ segments: url.pathname.split("/").filter(Boolean).slice(2) }),
		};
		const requested = [...request.headers.keys()]
			.filter((name) => !SAFELISTED_REQUEST_HEADERS.has(name))
			.sort();

		const preflight = route.OPTIONS(
			new Request(url, {
				method: "OPTIONS",
				headers: {
					origin,
					"access-control-request-method": request.method,
					"access-control-request-headers": requested.join(","),
				},
			}),
		);
		preflights.push({ method: request.method, requested, status: preflight.status });
		const allowedHeaders = list(preflight.headers.get("access-control-allow-headers"));
		if (
			!preflight.ok ||
			preflight.headers.get("access-control-allow-origin") !== origin ||
			!list(preflight.headers.get("access-control-allow-methods")).includes(
				request.method.toLowerCase(),
			) ||
			requested.some((name) => !allowedHeaders.includes(name))
		) {
			throw new TypeError("Failed to fetch");
		}

		const headers = new Headers(request.headers);
		headers.set("origin", origin);
		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		const response = await route[request.method](
			new Request(url, {
				method: request.method,
				headers,
				body: hasBody ? await request.arrayBuffer() : undefined,
				signal: request.signal,
			}),
			context,
		);
		if (response.headers.get("access-control-allow-origin") !== origin) {
			await response.body?.cancel();
			throw new TypeError("Failed to fetch");
		}
		const exposed = list(response.headers.get("access-control-expose-headers"));
		const visible = new Headers();
		response.headers.forEach((value, name) => {
			if (SAFELISTED_RESPONSE_HEADERS.has(name) || exposed.includes(name)) visible.set(name, value);
		});
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: visible,
		});
	};
}

describe("README Calling from another origin", () => {
	let upstream: Request[];
	let respond: () => Response;
	let preflights: Preflight[];
	let route: Route;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		upstream = [];
		preflights = [];
		route = readmeRoute({
			baseUrl: GATEWAY_URL,
			fetch: async (input, init) => {
				upstream.push(new Request(input, init));
				return respond();
			},
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function client(origin: string) {
		return createGateway({
			baseURL: ROUTE_URL,
			apiKey: "caller-token",
			fetch: browserFetch(route, origin, preflights),
		});
	}

	it("streams to a page on an allowed origin after a preflight that allows every header the client sends", async () => {
		respond = () =>
			new Response(streamParts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), {
				headers: { "content-type": "text/event-stream" },
			});

		const result = streamText({ model: client(ALLOWED_ORIGIN)(MODEL), prompt: "Hi" });

		expect(await result.text).toBe("Hello cross-origin");
		expect(preflights).toHaveLength(1);
		expect(preflights[0]).toMatchObject({ method: "POST", status: 204 });
		expect(preflights[0].requested).toEqual(
			expect.arrayContaining(["authorization", "content-type", "ai-language-model-streaming"]),
		);
		expect(upstream).toHaveLength(1);
		expect(upstream[0].url).toBe(`${GATEWAY_URL}/language-model`);
		expect(upstream[0].headers.get("authorization")).toBe(`Bearer ${GATEWAY_KEY}`);
	});

	it("serves the GET model list to a page on an allowed origin", async () => {
		respond = () =>
			Response.json({
				models: [
					{
						id: "openai/gpt-5",
						name: "GPT-5",
						specification: { specificationVersion: "v4", provider: "openai", modelId: "gpt-5" },
						modelType: "language",
					},
				],
			});

		const { models } = await client(ALLOWED_ORIGIN).getAvailableModels();

		expect(models.map((model) => model.id)).toEqual(["openai/gpt-5"]);
		expect(preflights.map(({ method }) => method)).toEqual(["GET"]);
	});

	it("stops a page on an unlisted origin at the preflight, before the gateway is called", async () => {
		respond = () => Response.json({});

		const error = await generateText({
			model: client("https://other.example")(MODEL),
			prompt: "Hi",
			maxRetries: 0,
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(Error);
		expect(preflights).toHaveLength(1);
		expect(upstream).toHaveLength(0);
	});

	it("lets the page read retry-after and retry-after-ms on a gateway 429", async () => {
		respond = () =>
			Response.json(
				{ error: { message: "Rate limited", type: "rate_limit_exceeded" } },
				{ status: 429, headers: { "retry-after": "1", "retry-after-ms": "1000" } },
			);
		const fetchFromPage = browserFetch(route, ALLOWED_ORIGIN, preflights);

		const response = await fetchFromPage(`${ROUTE_URL}/language-model`, {
			method: "POST",
			headers: {
				authorization: "Bearer caller-token",
				"content-type": "application/json",
				"ai-language-model-id": MODEL,
			},
			body: JSON.stringify({ prompt: [] }),
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("1");
		expect(response.headers.get("retry-after-ms")).toBe("1000");
		expect(await response.json()).toMatchObject({ error: { type: "rate_limit_exceeded" } });
	});
});
