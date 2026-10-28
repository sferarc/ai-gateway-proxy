/**
 * Pins the `@ai-sdk/gateway` calls that never reach a proxy route, by recording the URLs a client
 * pointed at the proxy builds. The README lists them under "Client".
 */

import { createGatewayProvider } from "@ai-sdk/gateway";
import { describe, expect, it } from "vitest";

// The client's baseURL when the proxy is mounted at /api/ai on the app.
const PROXY_BASE_URL = "https://app.example/api/ai";

function recordingClient() {
	const urls: string[] = [];
	const provider = createGatewayProvider({
		baseURL: PROXY_BASE_URL,
		apiKey: "client-bypass-dummy-key",
		fetch: async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			urls.push(url);
			const body = url.endsWith("/v1/realtime/client-secrets")
				? { token: "vcst_dummy" }
				: { error: { message: "not served by this test", type: "internal_server_error" } };
			return new Response(JSON.stringify(body), {
				status: "token" in body ? 200 : 500,
				headers: { "content-type": "application/json" },
			});
		},
	});
	return { provider, urls };
}

describe("client calls that do not go through the proxy", () => {
	it.each([
		["getCredits", "https://app.example/v1/credits"],
		["getSpendReport", "https://app.example/v1/report?start_date=2026-10-01&end_date=2026-10-28"],
		["getGenerationInfo", "https://app.example/v1/generation?id=gen_1"],
	] as const)(
		"sends %s to the origin of baseURL, outside the proxy route",
		async (call, expected) => {
			const { provider, urls } = recordingClient();

			const pending =
				call === "getCredits"
					? provider.getCredits()
					: call === "getSpendReport"
						? provider.getSpendReport({ startDate: "2026-10-01", endDate: "2026-10-28" })
						: provider.getGenerationInfo({ id: "gen_1" });
			await pending.catch(() => {});

			expect(urls).toEqual([expected]);
		},
	);

	it.each([
		["experimental_realtime", "realtime-model"],
		["experimental_transcription", "transcription-model"],
		["experimental_speech", "speech-model"],
	] as const)(
		"mints a %s token at the origin and hands back a WebSocket URL under baseURL",
		async (surface, path) => {
			const { provider, urls } = recordingClient();

			const { token, url } = await provider[surface].getToken({ model: "openai/gpt-realtime-2" });

			expect(urls).toEqual(["https://app.example/v1/realtime/client-secrets"]);
			expect(token).toBe("vcst_dummy");
			expect(url).toBe(`wss://app.example/api/ai/${path}?ai-model-id=openai%2Fgpt-realtime-2`);
		},
	);
});
