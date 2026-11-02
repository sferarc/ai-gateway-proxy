/**
 * The README's "Protecting the route" wrapper, served over HTTP between a real `@ai-sdk/gateway`
 * client and a local fake gateway. No gateway key or network is needed.
 */

import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { createGateway, GatewayInvalidRequestError } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./proxy";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "route-auth-dummy-gateway-key";
const SESSION_TOKEN = "route-auth-session-token";

// The handler in README.md's "Protecting the route", with the proxy and session check passed in; change both together.
function readmeHandler(
	proxy: ReturnType<typeof createGatewayProxy>,
	isValidSession: (token: string) => Promise<boolean>,
) {
	return async function handler(
		request: Request,
		context: { params: Promise<{ segments: string[] }> },
	) {
		const authorization = request.headers.get("authorization");
		const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
		if (!token || !(await isValidSession(token))) {
			// Not authentication_error: @ai-sdk/gateway replaces that message with advice about gateway keys.
			return Response.json(
				{ error: { message: "Sign in to use the AI route", type: "invalid_request_error" } },
				{ status: 401 },
			);
		}
		return proxy(request, context);
	};
}

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

describe("README route protection", () => {
	let upstreamHeaders: IncomingHttpHeaders[];
	let routeCalls: number;
	let gatewayServer: ReturnType<typeof createServer>;
	let routeServer: ReturnType<typeof createServer>;
	let routeUrl: string;

	beforeEach(async () => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		upstreamHeaders = [];
		routeCalls = 0;
		gatewayServer = createServer(async (req, res) => {
			for await (const _ of req) {
			}
			upstreamHeaders.push(req.headers);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					content: [{ type: "text", text: "Hello signed in" }],
					finishReason: { unified: "stop", raw: "stop" },
					usage: {
						inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 5, text: 5, reasoning: 0 },
					},
					warnings: [],
				}),
			);
		});
		const gatewayUrl = await listen(gatewayServer);

		const handler = readmeHandler(
			createGatewayProxy({ baseUrl: `${gatewayUrl}/v4/ai` }),
			async (token) => token === SESSION_TOKEN,
		);
		routeServer = createServer(async (req, res) => {
			routeCalls++;
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk);
			}
			const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
			const response = await handler(
				new Request(url, {
					method: req.method,
					headers: req.headers as Record<string, string>,
					body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
				}),
				{ params: Promise.resolve({ segments: url.pathname.split("/").filter(Boolean).slice(2) }) },
			);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		});
		routeUrl = `${await listen(routeServer)}/api/ai`;
	});

	afterEach(async () => {
		await close(routeServer);
		await close(gatewayServer);
		vi.unstubAllEnvs();
	});

	it("answers a caller without a valid token 401 once, before the gateway is called", async () => {
		const gateway = createGateway({ baseURL: routeUrl, apiKey: "not-a-session" });

		const error = await generateText({ model: gateway(MODEL), prompt: "Hi" }).catch(
			(e: unknown) => e,
		);

		expect(GatewayInvalidRequestError.isInstance(error)).toBe(true);
		expect(error).toMatchObject({ statusCode: 401, message: "Sign in to use the AI route" });
		expect(routeCalls).toBe(1);
		expect(upstreamHeaders).toHaveLength(0);
	});

	it("forwards a signed-in call with the proxy's key, never the caller's token", async () => {
		const gateway = createGateway({ baseURL: routeUrl, apiKey: SESSION_TOKEN });

		const { text } = await generateText({ model: gateway(MODEL), prompt: "Hi" });

		expect(text).toBe("Hello signed in");
		expect(upstreamHeaders).toHaveLength(1);
		expect(upstreamHeaders[0].authorization).toBe(`Bearer ${GATEWAY_KEY}`);
		expect(JSON.stringify(upstreamHeaders[0])).not.toContain(SESSION_TOKEN);
	});
});
