import { getVercelOidcToken } from "@vercel/oidc";

export type GatewayAuthToken = {
	token: string;
	authMethod: "api-key" | "oidc";
};

/**
 * Get authentication token for the AI Gateway.
 * Tries API key first (AI_GATEWAY_API_KEY env var), then falls back to Vercel OIDC.
 */
export async function getGatewayAuthToken(): Promise<GatewayAuthToken | null> {
	const apiKey = process.env.AI_GATEWAY_API_KEY;
	if (apiKey) {
		return { token: apiKey, authMethod: "api-key" };
	}

	try {
		const oidcToken = await getVercelOidcToken();
		return { token: oidcToken, authMethod: "oidc" };
	} catch {
		return null;
	}
}
