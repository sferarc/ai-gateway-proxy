import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { type GatewayAuthToken, getGatewayAuthToken } from "./auth";
import { createStreamTransformer } from "./stream";
import type {
	CreateGatewayProxyOptions,
	CreateGatewayProxyResult,
	GatewayError,
	GatewayResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1/ai";
const PROTOCOL_VERSION = "0.0.1";

/**
 * Extracts the path from the request using either a custom extractor or route params.
 */
async function extractPathFromRequest(
	request: Request,
	context: { params: Promise<Record<string, string | string[] | undefined>> } | undefined,
	options: { extractPath?: CreateGatewayProxyOptions["extractPath"]; segmentsParam: string },
): Promise<string> {
	if (options.extractPath) {
		return options.extractPath(request);
	}

	if (context?.params) {
		const params = await context.params;
		const segments = params[options.segmentsParam];
		return Array.isArray(segments) ? segments.join("/") : (segments ?? "");
	}

	return "";
}

/**
 * Builds the upstream URL from base URL, path, and query params.
 */
function buildUpstreamUrl(baseUrl: string, path: string, requestUrl: string): string {
	const searchParams = new URL(requestUrl).searchParams;
	const queryString = searchParams.toString();
	return `${baseUrl}/${path}${queryString ? `?${queryString}` : ""}`;
}

/**
 * Builds the headers for the upstream request.
 */
function buildRequestHeaders(
	auth: GatewayAuthToken,
	isStreaming: boolean,
	modelId: string | null,
	customHeaders?: Record<string, string>,
): Record<string, string> {
	return {
		"content-type": "application/json",
		...customHeaders,
		authorization: `Bearer ${auth.token}`,
		"ai-gateway-auth-method": auth.authMethod,
		"ai-gateway-protocol-version": PROTOCOL_VERSION,
		"ai-language-model-id": modelId ?? "",
		"ai-language-model-streaming": isStreaming ? "true" : "false",
	};
}

/**
 * Parses the error response from the gateway.
 */
async function parseErrorBody(res: Response): Promise<GatewayError> {
	try {
		return await res.json();
	} catch {
		return {
			error: {
				message: res.statusText || "Unknown error",
				type: "gateway_error",
			},
		};
	}
}

/**
 * Creates an error response, optionally applying the onError hook.
 */
async function createErrorResponse(
	res: Response,
	errorBody: GatewayError,
	requestBody: LanguageModelV3CallOptions,
	onError: CreateGatewayProxyOptions["onError"],
): Promise<Response> {
	if (onError) {
		const result = await onError({
			request: requestBody,
			error: errorBody,
			status: res.status,
		});

		if (result instanceof Response) {
			return result;
		}

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

/**
 * Handles a streaming response from the gateway.
 */
function handleStreamingResponse(
	res: Response,
	requestBody: LanguageModelV3CallOptions,
	afterResponse: CreateGatewayProxyOptions["afterResponse"],
): Response {
	if (!res.body) {
		return new Response("No response body", { status: 500 });
	}

	const contentType = res.headers.get("content-type") || "text/event-stream";

	// Pass through directly if no afterResponse hook
	if (!afterResponse) {
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: { "content-type": contentType },
		});
	}

	// Transform stream to call afterResponse on finish
	const transformedStream = createStreamTransformer(res.body, requestBody, afterResponse);

	return new Response(transformedStream, {
		status: res.status,
		statusText: res.statusText,
		headers: { "content-type": contentType },
	});
}

/**
 * Handles a non-streaming JSON response from the gateway.
 */
async function handleJsonResponse(
	res: Response,
	requestBody: LanguageModelV3CallOptions,
	afterResponse: CreateGatewayProxyOptions["afterResponse"],
): Promise<Response> {
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
}

/**
 * Creates a proxy handler for the Vercel AI Gateway.
 *
 * Uses AI SDK V3 Language Model.
 * @see https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-language-model.ts
 */
export const createGatewayProxy = ({
	baseUrl = DEFAULT_BASE_URL,
	headers,
	segmentsParam = "segments",
	extractPath,
	beforeRequest,
	afterResponse,
	onError,
}: CreateGatewayProxyOptions = {}): CreateGatewayProxyResult => {
	const handler = async (
		request: Request,
		context?: { params: Promise<Record<string, string | string[] | undefined>> },
	) => {
		// Authenticate with the gateway
		const auth = await getGatewayAuthToken();
		if (!auth) {
			return new Response("AI Gateway authentication not configured", { status: 500 });
		}

		// Build upstream URL
		const path = await extractPathFromRequest(request, context, { extractPath, segmentsParam });
		const upstream = buildUpstreamUrl(baseUrl, path, request.url);

		// Parse request body
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
				headers: buildRequestHeaders(
					auth,
					isStreaming,
					request.headers.get("ai-language-model-id"),
					headers,
				),
			} as RequestInit);

			// Handle error responses
			if (!res.ok) {
				const errorBody = await parseErrorBody(res);
				return createErrorResponse(res, errorBody, requestBody, onError);
			}

			// Handle successful responses
			if (isStreaming) {
				return handleStreamingResponse(res, requestBody, afterResponse);
			}

			return handleJsonResponse(res, requestBody, afterResponse);
		} catch {
			return new Response("Error proxying request to AI Gateway", { status: 500 });
		}
	};

	// Export handler for all HTTP methods
	handler.GET = handler;
	handler.POST = handler;
	handler.PUT = handler;
	handler.DELETE = handler;
	handler.PATCH = handler;

	return handler;
};
