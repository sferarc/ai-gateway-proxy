import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { getGatewayAuthToken } from "./auth";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

import { getVercelOidcToken } from "@vercel/oidc";

describe("getGatewayAuthToken", () => {
	let errorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubEnv("AI_GATEWAY_API_KEY", "");
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetAllMocks();
		errorSpy.mockRestore();
	});

	function loggedText(): string {
		return errorSpy.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");
	}

	it("returns null and logs the OIDC failure message once", async () => {
		vi.mocked(getVercelOidcToken).mockRejectedValueOnce(
			new Error("The 'x-vercel-oidc-token' header is missing from the request"),
		);

		expect(await getGatewayAuthToken()).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"AI Gateway auth: no AI_GATEWAY_API_KEY and Vercel OIDC token unavailable:",
			"The 'x-vercel-oidc-token' header is missing from the request",
		);
	});

	it("logs a non-Error rejection as a string", async () => {
		vi.mocked(getVercelOidcToken).mockRejectedValueOnce("refresh failed");

		expect(await getGatewayAuthToken()).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(loggedText()).toContain("refresh failed");
	});

	it("logs only the message, not properties that could carry a token", async () => {
		const error = Object.assign(new Error("token expired"), { token: "stale-oidc-token-abc" });
		vi.mocked(getVercelOidcToken).mockRejectedValueOnce(error);

		expect(await getGatewayAuthToken()).toBeNull();
		expect(loggedText()).toContain("token expired");
		expect(loggedText()).not.toContain("stale-oidc-token-abc");
	});

	it("does not log when the API key is set", async () => {
		vi.stubEnv("AI_GATEWAY_API_KEY", "secret-api-key");

		expect(await getGatewayAuthToken()).toEqual({ token: "secret-api-key", authMethod: "api-key" });
		expect(getVercelOidcToken).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("does not log when OIDC succeeds", async () => {
		vi.mocked(getVercelOidcToken).mockResolvedValueOnce("oidc-token-123");

		expect(await getGatewayAuthToken()).toEqual({ token: "oidc-token-123", authMethod: "oidc" });
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
