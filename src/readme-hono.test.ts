/**
 * The README's Hono route, run through a real Hono app between a real `@ai-sdk/gateway` client and
 * a fake gateway passed as the proxy's `fetch`. No gateway key, server or network is needed.
 */

import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "hono-dummy-gateway-key";
const GATEWAY_URL = "https://gateway.test/v4/ai";

const usage = {
	inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const streamParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: "Hello " },
	{ type: "text-delta", id: "t1", delta: "Hono" },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

// The Hono example in README.md, with the proxy's other options passed in; change both together.
function readmeApp(options: Omit<CreateGatewayProxyOptions, "extractPath">) {
	const app = new Hono();

	const proxy = createGatewayProxy({
		...options,
		extractPath: (request) => {
			const url = new URL(request.url);
			return url.pathname.replace(/^\/api\/ai\//, "");
		},
	});

	app.all("/api/ai/*", (c) => proxy(c.req.raw));
	return app;
}

type Recorded = { url: string; method: string; authorization: string | null; body: string };

describe("README Hono route", () => {
	let recorded: Recorded[];
	let respond: () => Response;

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		recorded = [];
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function client(options: Omit<CreateGatewayProxyOptions, "extractPath" | "fetch"> = {}) {
		const app = readmeApp({
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
		return createGateway({
			baseURL: "https://app.test/api/ai",
			apiKey: "unused",
			fetch: async (input, init) => app.fetch(new Request(input, init)),
		});
	}

	it("forwards a generateText call to the gateway path after /api/ai with the proxy's key", async () => {
		respond = () =>
			Response.json({
				content: [{ type: "text", text: "Hello Hono" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage,
				warnings: [],
			});
		const gateway = client();

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello Hono");
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

		expect(await result.text).toBe("Hello Hono");
		expect(afterResponse).toHaveBeenCalledOnce();
		expect(afterResponse.mock.calls[0][0].response.usage).toEqual(usage);
	});

	it("forwards a GET such as getAvailableModels without a body", async () => {
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
		const gateway = client();

		const { models } = await gateway.getAvailableModels();

		expect(models.map((model) => model.id)).toEqual(["openai/gpt-5"]);
		expect(recorded).toEqual([
			{
				url: `${GATEWAY_URL}/config`,
				method: "GET",
				authorization: `Bearer ${GATEWAY_KEY}`,
				body: "",
			},
		]);
	});
});
