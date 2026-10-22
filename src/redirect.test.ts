/**
 * Keyless test over real HTTP: a fake gateway answers with a redirect to a second listener, and
 * the proxy must refuse it without sending anything there.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GatewayError } from "@ai-sdk/gateway";
import { APICallError } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProxyServer } from "./test-server";

const MODEL = "test/fake-model";
const GATEWAY_KEY = "redirect-dummy-gateway-key";
const REFUSED = "Upstream redirected, the proxy does not follow redirects";

function listen(server: Server): Promise<string> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});
}

describe("redirecting gateway over HTTP", () => {
	let gatewayServer: Server;
	let targetServer: Server;
	let closeProxy: (() => Promise<void>) | undefined;
	let gatewayRequests: IncomingMessage[];
	let targetRequests: IncomingMessage[];

	beforeEach(() => {
		vi.stubEnv("AI_GATEWAY_API_KEY", GATEWAY_KEY);
		gatewayRequests = [];
		targetRequests = [];
	});

	afterEach(async () => {
		await closeProxy?.();
		closeProxy = undefined;
		await close(gatewayServer);
		await close(targetServer);
		vi.unstubAllEnvs();
	});

	async function setup(status: number) {
		targetServer = createServer((req, res) => {
			targetRequests.push(req);
			res.statusCode = 200;
			res.end("{}");
		});
		const targetUrl = await listen(targetServer);

		gatewayServer = createServer((req, res) => {
			gatewayRequests.push(req);
			req.resume();
			res.statusCode = status;
			res.setHeader("location", `${targetUrl}/stolen`);
			res.end();
		});
		const gatewayUrl = await listen(gatewayServer);

		const onError = vi.fn();
		const { gateway, close: closeServer } = await startProxyServer({
			proxyOptions: { baseUrl: gatewayUrl, onError },
		});
		closeProxy = closeServer;
		return { gateway, onError };
	}

	function expectRefused(error: unknown) {
		if (!GatewayError.isInstance(error))
			throw new Error("expected a GatewayError", { cause: error });
		expect(error.statusCode).toBe(502);
		expect(error.message).toBe(REFUSED);
		expect(APICallError.isInstance(error.cause) ? error.cause.responseBody : undefined).toBe(
			JSON.stringify({ error: { message: REFUSED, type: "proxy_error" } }),
		);
	}

	it.each([301, 302, 307, 308])(
		"returns 502 and sends nothing to the target on a %i",
		async (status) => {
			const { gateway, onError } = await setup(status);

			const error = await generateText({
				model: gateway(MODEL),
				prompt: "hi",
				maxRetries: 0,
			}).then(
				() => undefined,
				(e: unknown) => e,
			);

			expectRefused(error);
			expect(gatewayRequests).toHaveLength(1);
			expect(targetRequests).toHaveLength(0);
			expect(onError).not.toHaveBeenCalled();
		},
	);

	it("refuses the redirect on a streaming call too", async () => {
		const { gateway, onError } = await setup(302);

		let streamError: unknown;
		const result = streamText({
			model: gateway(MODEL),
			prompt: "hi",
			maxRetries: 0,
			onError: ({ error }) => {
				streamError = error;
			},
		});
		await result.consumeStream({ onError: () => {} });

		expectRefused(streamError);
		expect(targetRequests).toHaveLength(0);
		expect(onError).not.toHaveBeenCalled();
	});
});
