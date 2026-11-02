import { getVercelOidcToken } from "@vercel/oidc";

export type GatewayAuthToken = {
	token: string;
	authMethod: "api-key" | "oidc";
};

/**
 * Get authentication token for the AI Gateway.
 * Tries API key first (AI_GATEWAY_API_KEY env var), then falls back to Vercel OIDC.
 * Returns `null` when neither is available, after logging why OIDC failed, and the proxy then answers 500.
 */
export async function getGatewayAuthToken(): Promise<GatewayAuthToken | null> {
	const apiKey = process.env.AI_GATEWAY_API_KEY;
	if (apiKey) {
		return { token: apiKey, authMethod: "api-key" };
	}

	try {
		const oidcToken = await getVercelOidcToken();
		return { token: oidcToken, authMethod: "oidc" };
	} catch (error) {
		// Only the message: the error object could carry token material.
		console.error(
			"AI Gateway auth: no AI_GATEWAY_API_KEY and Vercel OIDC token unavailable:",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}

/**
 * A gateway API key, or a function of the incoming request that returns one.
 */
export type GatewayApiKey =
	| string
	| ((request: Request) => string | null | undefined | Promise<string | null | undefined>);

/**
 * Resolves the `apiKey` option for one request. Returns `null` when it gives no key or throws,
 * after logging why, and never falls back to the environment or OIDC.
 */
export async function resolveApiKeyOption(
	apiKey: GatewayApiKey,
	request: Request,
): Promise<GatewayAuthToken | null> {
	try {
		const key = typeof apiKey === "function" ? await apiKey(request) : apiKey;
		if (typeof key === "string" && key !== "") {
			return { token: key, authMethod: "api-key" };
		}
		console.error("AI Gateway auth: the apiKey option gave no key");
		return null;
	} catch (error) {
		// Only the message: the error object could carry token material.
		console.error(
			"AI Gateway auth: the apiKey option failed:",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}
