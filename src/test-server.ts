import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createGateway } from "@ai-sdk/gateway";
import { createGatewayProxy } from "./proxy";
import type { CreateGatewayProxyOptions } from "./types";

type ProxyServerOptions = {
	proxyOptions?: CreateGatewayProxyOptions;
	/**
	 * The name of the segments parameter to use when passing to the proxy.
	 * @default "segments"
	 */
	segmentsParam?: string;
	/**
	 * If true, call the proxy without context (for testing extractPath).
	 */
	noContext?: boolean;
	/**
	 * Abort `request.signal` when the client disconnects. When false, a disconnect only cancels
	 * the response body, so a test can tell the two cancellation paths apart.
	 * @default true
	 */
	forwardAbortSignal?: boolean;
};

/**
 * Serves the proxy on a local port, bridging node:http to the Fetch API the way a framework
 * route handler does, and returns an `@ai-sdk/gateway` provider pointed at it.
 */
export function startProxyServer(options: ProxyServerOptions = {}) {
	const {
		proxyOptions = {},
		segmentsParam = "segments",
		noContext = false,
		forwardAbortSignal = true,
	} = options;
	const proxy = createGatewayProxy(proxyOptions);

	const server = createServer(async (req, res) => {
		const disconnected = new AbortController();
		res.on("close", () => {
			if (!res.writableFinished) disconnected.abort();
		});

		const url = new URL(req.url || "/", `http://${req.headers.host}`);
		const segments = url.pathname.split("/").filter(Boolean);

		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const body = Buffer.concat(chunks).toString();

		const request = new Request(url.toString(), {
			method: req.method,
			headers: Object.fromEntries(
				Object.entries(req.headers).filter(([, v]) => v !== undefined) as [string, string][],
			),
			body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
			signal: forwardAbortSignal ? disconnected.signal : undefined,
		});

		const response = noContext
			? await proxy(request)
			: await proxy(request, {
					params: Promise.resolve({ [segmentsParam]: segments }),
				});

		if (disconnected.signal.aborted) {
			await response.body?.cancel();
			return;
		}

		res.statusCode = response.status;
		response.headers.forEach((value, key) => {
			res.setHeader(key, value);
		});

		if (response.body) {
			const reader = response.body.getReader();
			disconnected.signal.addEventListener("abort", () => {
				reader.cancel().catch(() => {});
			});
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					res.write(value);
				}
			} catch {
				// The client went away or the upstream failed mid-stream.
			}
		}
		res.end();
	});

	return new Promise<{
		gateway: ReturnType<typeof createGateway>;
		close: () => Promise<void>;
	}>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			const gateway = createGateway({
				baseURL: `http://127.0.0.1:${port}`,
				// The proxy handles auth, so the client sends a key the proxy must replace
				apiKey: "proxy-handles-auth",
			});

			resolve({
				gateway,
				close: () =>
					new Promise<void>((resolve) => {
						server.closeAllConnections();
						server.close(() => resolve());
					}),
			});
		});
	});
}
