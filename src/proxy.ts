import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { getGatewayAuthToken } from "./auth";
import { createStreamTransformer } from "./stream";
import type {
	CreateGatewayProxyOptions,
	CreateGatewayProxyResult,
	GatewayError,
	GatewayResponse,
} from "./types";

/**
 * Creates a proxy handler for the Vercel AI Gateway.
 *
 * Uses AI SDK V3 Language Model.
 * @see https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-language-model.ts
 */
export const createGatewayProxy = ({
	baseUrl = "https://ai-gateway.vercel.sh/v1/ai",
	headers,
	beforeRequest,
	afterResponse,
	onError,
}: CreateGatewayProxyOptions = {}): CreateGatewayProxyResult => {
	const handler = async (
		request: Request,
		{ params }: { params: Promise<{ segments?: string[] }> },
	) => {
		const auth = await getGatewayAuthToken();
		if (!auth) {
			return new Response("AI Gateway authentication not configured", {
				status: 500,
			});
		}

		const { segments } = await params;
		const path = segments?.join("/") ?? "";
		const searchParams = new URL(request.url).searchParams;
		const upstream = `${baseUrl}/${path}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

		let requestBody: LanguageModelV3CallOptions;
		try {
			requestBody = await request.clone().json();
		} catch {
			return new Response("Invalid JSON body", { status: 400 });
		}

		// Apply beforeRequest hook
		if (beforeRequest) {
			requestBody = await beforeRequest({ request: requestBody });
		}

		const isStreaming = request.headers.get("ai-language-model-streaming") === "true";

		try {
			const res = await fetch(upstream, {
				method: request.method,
				body: JSON.stringify(requestBody),
				duplex: "half",
				headers: {
					"content-type": "application/json",
					...headers,
					authorization: `Bearer ${auth.token}`,
					"ai-gateway-auth-method": auth.authMethod,
					"ai-gateway-protocol-version": "0.0.1",
					"ai-language-model-id": request.headers.get("ai-language-model-id") ?? "",
					"ai-language-model-streaming": isStreaming ? "true" : "false",
				},
			} as RequestInit);

			// Handle error responses
			if (!res.ok) {
				let errorBody: GatewayError;
				try {
					errorBody = await res.json();
				} catch {
					errorBody = {
						error: {
							message: res.statusText || "Unknown error",
							type: "gateway_error",
						},
					};
				}

				if (onError) {
					const result = await onError({
						request: requestBody,
						error: errorBody,
						status: res.status,
					});

					// If onError returns a Response, use it directly
					if (result instanceof Response) {
						return result;
					}

					// Otherwise, return the modified error
					return new Response(JSON.stringify(result), {
						status: res.status,
						statusText: res.statusText,
						headers: { "content-type": "application/json" },
					});
				}

				return new Response(JSON.stringify(errorBody), {
					status: res.status,
					statusText: res.statusText,
					headers: { "content-type": "application/json" },
				});
			}

			// For streaming responses
			if (isStreaming) {
				if (!res.body) {
					return new Response("No response body", { status: 500 });
				}

				// If no afterResponse hook, pass through directly
				if (!afterResponse) {
					return new Response(res.body, {
						status: res.status,
						statusText: res.statusText,
						headers: {
							"content-type": res.headers.get("content-type") || "text/event-stream",
						},
					});
				}

				// Transform the stream to call afterResponse on finish
				const transformedStream = createStreamTransformer(res.body, requestBody, afterResponse);

				return new Response(transformedStream, {
					status: res.status,
					statusText: res.statusText,
					headers: {
						"content-type": res.headers.get("content-type") || "text/event-stream",
					},
				});
			}

			// For non-streaming responses, parse and optionally transform
			let responseBody: GatewayResponse = await res.json();

			if (afterResponse) {
				responseBody = await afterResponse({
					request: requestBody,
					response: responseBody,
				});
			}

			return new Response(JSON.stringify(responseBody), {
				status: res.status,
				statusText: res.statusText,
				headers: { "content-type": "application/json" },
			});
		} catch {
			return new Response("Error proxying request to AI Gateway", {
				status: 500,
			});
		}
	};

	handler.GET = handler;
	handler.POST = handler;
	handler.PUT = handler;
	handler.DELETE = handler;
	handler.PATCH = handler;

	return handler;
};
