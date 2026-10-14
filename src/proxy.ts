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

function isSafePath(path: string): boolean {
	if (path.startsWith("/") || path.includes("://")) {
		return false;
	}

	for (const segment of path.split("/")) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			return false;
		}
		if (decoded === "." || decoded === ".." || /[/\\\0]/.test(decoded)) {
			return false;
		}
	}

	return true;
}

/**
 * Builds the upstream URL from base URL, path, and query params.
 * Returns null when the path would leave the base URL.
 */
function buildUpstreamUrl(baseUrl: string, path: string, requestUrl: string): string | null {
	if (!isSafePath(path)) {
		return null;
	}

	const base = new URL(baseUrl.replace(/\/?$/, "/"));
	// The "./" prefix keeps a segment containing ":" from being parsed as a scheme.
	const url = new URL(`./${path}`, base);
	if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
		return null;
	}

	const queryString = new URL(requestUrl).searchParams.toString();
	if (queryString) {
		url.search = queryString;
	}
	return url.toString();
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

type ProxyErrorType = "authentication_error" | "invalid_request_error" | "proxy_error";

/**
 * Builds a response for an error the proxy raises itself, in the same shape as upstream errors.
 */
function proxyErrorResponse(status: number, type: ProxyErrorType, message: string): Response {
	const body: GatewayError = { error: { message, type } };
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function proxyFailureResponse(request: Request, error: unknown): Response {
	if (request.signal.aborted) {
		return new Response(null, { status: 499 });
	}
	console.error("AI Gateway proxy request failed:", error);
	return proxyErrorResponse(500, "proxy_error", "Error proxying request to AI Gateway");
}

/**
 * Forwards a GET or HEAD request, such as the gateway's `/config` model list, without a body.
 * The hooks are typed for language model calls, so none of them run here.
 */
async function forwardBodylessRequest(
	request: Request,
	upstream: string,
	auth: GatewayAuthToken,
	customHeaders?: Record<string, string>,
): Promise<Response> {
	try {
		const res = await fetch(upstream, {
			method: request.method,
			signal: request.signal,
			headers: {
				...customHeaders,
				authorization: `Bearer ${auth.token}`,
				"ai-gateway-auth-method": auth.authMethod,
				"ai-gateway-protocol-version": PROTOCOL_VERSION,
			},
		});

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
		});
	} catch (error) {
		return proxyFailureResponse(request, error);
	}
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
		return proxyErrorResponse(500, "proxy_error", "No response body");
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
			return proxyErrorResponse(
				500,
				"authentication_error",
				"AI Gateway authentication not configured: set AI_GATEWAY_API_KEY or deploy on Vercel with OIDC enabled",
			);
		}

		try {
			// Build upstream URL
			const path = await extractPathFromRequest(request, context, { extractPath, segmentsParam });
			const upstream = buildUpstreamUrl(baseUrl, path, request.url);
			if (!upstream) {
				return proxyErrorResponse(400, "invalid_request_error", "Invalid path");
			}

			if (request.method === "GET" || request.method === "HEAD") {
				return await forwardBodylessRequest(request, upstream, auth, headers);
			}

			// Parse request body
			let requestBody: LanguageModelV3CallOptions;
			try {
				requestBody = await request.clone().json();
			} catch {
				return proxyErrorResponse(400, "invalid_request_error", "Invalid JSON body");
			}

			// Apply beforeRequest hook
			if (beforeRequest) {
				requestBody = await beforeRequest({ request: requestBody });
			}

			const isStreaming = request.headers.get("ai-language-model-streaming") === "true";

			const res = await fetch(upstream, {
				method: request.method,
				body: JSON.stringify(requestBody),
				duplex: "half",
				signal: request.signal,
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
				return await createErrorResponse(res, errorBody, requestBody, onError);
			}

			// Handle successful responses
			if (isStreaming) {
				return handleStreamingResponse(res, requestBody, afterResponse);
			}

			return await handleJsonResponse(res, requestBody, afterResponse);
		} catch (error) {
			return proxyFailureResponse(request, error);
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
