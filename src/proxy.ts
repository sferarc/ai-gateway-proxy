import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { type GatewayAuthToken, getGatewayAuthToken } from "./auth";
import { gatewayErrorProblem, gatewayResponseProblem, isRecord } from "./hook-result";
import { createStreamTransformer } from "./stream";
import type {
	CreateGatewayProxyOptions,
	CreateGatewayProxyResult,
	GatewayError,
	GatewayResponse,
	ModelCallKind,
	RawResponseContext,
} from "./types";

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1/ai";
const PROTOCOL_VERSION = "0.0.1";
const MAX_ERROR_EXCERPT_LENGTH = 200;
// Request ids for matching gateway-side logs, and the rate limit headers the AI SDK backs off on.
const FORWARDED_RESPONSE_HEADER =
	/^(?:x-vercel-id|x-request-id|retry-after|retry-after-ms|x-ratelimit-.+)$/;
// Headers @ai-sdk/gateway sets to describe the model call; they must match the body the client built.
const MODEL_CALL_HEADER =
	/^(?:ai-language-model-.+|ai-model-id|ai-[a-z]+-model-specification-version)$/;
const REQUEST_METADATA_HEADER = /^(?:ai-o11y-.+|idempotency-key|accept)$/;
// Paths relative to baseUrl where @ai-sdk/gateway 4.x posts a call that is not a language model call.
const NON_LANGUAGE_MODEL_PATHS = new Map<string, ModelCallKind>([
	["embedding-model", "embedding"],
	["image-model", "image"],
	["video-model", "video"],
	["video-model/start", "video"],
	["speech-model", "speech"],
	["transcription-model", "transcription"],
	["reranking-model", "reranking"],
	["decision-model", "decision"],
	["batch/start", "batch"],
]);
// @ai-sdk/gateway's calls that read or cancel a job rather than start a model call.
const READ_PATHS = new Set(["batch/status", "batch/results", "batch/cancel", "video-model/status"]);
// Successful bodies that are a sequence of values rather than one JSON value: event streams and JSON Lines.
const STREAM_CONTENT_TYPE =
	/^\s*(?:text\/event-stream|application\/(?:x-ndjson|jsonl|jsonlines|x-jsonlines))\s*(?:;|$)/i;

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
 * Builds the upstream URL from base URL, path, and query params, with its pathname relative to
 * the base URL. Returns null when the path would leave the base URL.
 */
function buildUpstreamUrl(
	baseUrl: string,
	path: string,
	requestUrl: string,
): { url: string; relativePath: string } | null {
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
	return { url: url.toString(), relativePath: url.pathname.slice(base.pathname.length) };
}

/**
 * Applies the proxy's own headers over the caller's `headers`. `Headers` matches names
 * case-insensitively, so a custom `Authorization` cannot sit beside the gateway's `authorization`.
 */
function withGatewayHeaders(
	customHeaders: HeadersInit | undefined,
	gatewayHeaders: Record<string, string>,
): Record<string, string> {
	const headers = new Headers(customHeaders);
	for (const [name, value] of Object.entries(gatewayHeaders)) {
		headers.set(name, value);
	}
	return Object.fromEntries(headers);
}

/**
 * Builds the headers for the upstream request: the caller's `headers`, then the model call and
 * request metadata headers from the incoming request, then the proxy's own.
 */
function buildRequestHeaders(
	auth: GatewayAuthToken,
	request: Request,
	customHeaders?: Record<string, string>,
): Record<string, string> {
	const headers = new Headers(customHeaders);
	for (const name of [...headers.keys()]) {
		if (MODEL_CALL_HEADER.test(name)) {
			headers.delete(name);
		}
	}
	for (const [name, value] of request.headers) {
		if (MODEL_CALL_HEADER.test(name) || REQUEST_METADATA_HEADER.test(name)) {
			headers.set(name, value);
		}
	}

	return withGatewayHeaders(headers, {
		"content-type": "application/json",
		authorization: `Bearer ${auth.token}`,
		"ai-gateway-auth-method": auth.authMethod,
		"ai-gateway-protocol-version": PROTOCOL_VERSION,
	});
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

function isRedirect(res: Response): boolean {
	return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}

function redirectRefusedResponse(res: Response): Response {
	res.body?.cancel().catch(() => {});
	return proxyErrorResponse(
		502,
		"proxy_error",
		"Upstream redirected, the proxy does not follow redirects",
	);
}

function proxyFailureResponse(request: Request, error: unknown): Response {
	if (request.signal.aborted) {
		return new Response(null, { status: 499 });
	}
	console.error("AI Gateway proxy request failed:", error);
	return proxyErrorResponse(500, "proxy_error", "Error proxying request to AI Gateway");
}

/**
 * Forwards a GET or HEAD request, such as the gateway's `/config` model list, or a request whose
 * body is missing or empty, without a body.
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
			headers: withGatewayHeaders(customHeaders, {
				authorization: `Bearer ${auth.token}`,
				"ai-gateway-auth-method": auth.authMethod,
				"ai-gateway-protocol-version": PROTOCOL_VERSION,
			}),
			redirect: "manual",
		});

		if (isRedirect(res)) {
			return redirectRefusedResponse(res);
		}

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: responseHeaders(res, res.headers.get("content-type") ?? "application/json"),
		});
	} catch (error) {
		return proxyFailureResponse(request, error);
	}
}

function isGatewayError(value: unknown): value is GatewayError {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { error } = value as { error?: unknown };
	return (
		typeof error === "object" &&
		error !== null &&
		typeof (error as { message?: unknown }).message === "string"
	);
}

/**
 * Parses the error response from the gateway. A body that is not a JSON `{ error: { message } }`,
 * such as an HTML page from an edge or load balancer, becomes a `gateway_error` naming the status
 * and a short excerpt, so `onError` always receives the `GatewayError` shape.
 */
async function parseErrorBody(res: Response): Promise<GatewayError> {
	const text = await res.text().catch(() => "");
	try {
		const parsed: unknown = JSON.parse(text);
		if (isGatewayError(parsed)) {
			return parsed;
		}
	} catch {}
	const excerpt = text.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_EXCERPT_LENGTH);
	const message = excerpt
		? `AI Gateway returned ${res.status}: ${excerpt}`
		: `AI Gateway returned ${res.status} ${res.statusText}`.trimEnd();
	return {
		error: {
			message,
			type: "gateway_error",
		},
	};
}

/**
 * Builds response headers with the given content type plus the allowlisted upstream headers.
 */
function responseHeaders(res: Response, contentType: string): Headers {
	const headers = new Headers({ "content-type": contentType });
	for (const [name, value] of res.headers) {
		if (FORWARDED_RESPONSE_HEADER.test(name)) {
			headers.set(name, value);
		}
	}
	return headers;
}

/**
 * Creates an error response, optionally applying the onError hook.
 */
async function createErrorResponse(
	res: Response,
	upstreamError: GatewayError,
	requestBody: LanguageModelV4CallOptions,
	onError: CreateGatewayProxyOptions["onError"],
): Promise<Response> {
	let errorBody = upstreamError;
	if (onError) {
		const result = await onError({
			request: requestBody,
			error: upstreamError,
			status: res.status,
		});

		if (result instanceof Response) {
			return result;
		}

		// A JavaScript caller can return nothing, such as a hook that only logs.
		if (result === undefined || result === null) {
			console.error("onError hook returned no response, forwarding the upstream error body");
		} else {
			const problem = gatewayErrorProblem(result);
			if (problem) {
				console.error(
					`onError hook returned an invalid error, forwarding the upstream error body: ${problem}`,
				);
			} else {
				errorBody = result;
			}
		}
	}

	return new Response(JSON.stringify(errorBody), {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, "application/json"),
	});
}

/**
 * Handles a streaming response from the gateway.
 */
function handleStreamingResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
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
			headers: responseHeaders(res, contentType),
		});
	}

	// Transform stream to call afterResponse on finish
	const transformedStream = createStreamTransformer(res.body, requestBody, afterResponse);

	return new Response(transformedStream, {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, contentType),
	});
}

/**
 * Handles a non-streaming JSON response from the gateway.
 */
async function handleJsonResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
	afterResponse: CreateGatewayProxyOptions["afterResponse"],
): Promise<Response> {
	let responseBody: GatewayResponse = await res.json();

	if (afterResponse) {
		const modified = await afterResponse({
			request: requestBody,
			response: responseBody,
		});
		// A JavaScript caller can return nothing.
		if (modified === undefined || modified === null) {
			console.error("afterResponse hook returned no response, forwarding the upstream body");
		} else {
			const problem = gatewayResponseProblem(modified);
			if (problem) {
				const message = `afterResponse hook returned an invalid response: ${problem}`;
				console.error(message);
				return proxyErrorResponse(500, "proxy_error", message);
			}
			responseBody = modified;
		}
	}

	return new Response(JSON.stringify(responseBody), {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, "application/json"),
	});
}

type LanguageModelHooks = Pick<CreateGatewayProxyOptions, "afterResponse" | "onError">;

/**
 * Builds the client response for a non-redirect upstream response, running the language model hooks given.
 */
async function forwardUpstreamResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
	isStreaming: boolean,
	{ afterResponse, onError }: LanguageModelHooks,
): Promise<Response> {
	if (!res.ok) {
		const errorBody = await parseErrorBody(res);
		return await createErrorResponse(res, errorBody, requestBody, onError);
	}

	if (isStreaming) {
		return handleStreamingResponse(res, requestBody, afterResponse);
	}

	// Other calls can answer with a body that is not one JSON value, such as the video model's
	// event stream or the batch results' JSON Lines. It is not a language model response, so it
	// passes through without afterResponse.
	if (STREAM_CONTENT_TYPE.test(res.headers.get("content-type") ?? "")) {
		return handleStreamingResponse(res, requestBody, undefined);
	}

	return await handleJsonResponse(res, requestBody, afterResponse);
}

/**
 * Runs afterRawResponse and returns the response to send.
 */
async function applyAfterRawResponse(
	afterRawResponse: NonNullable<CreateGatewayProxyOptions["afterRawResponse"]>,
	context: RawResponseContext,
): Promise<Response> {
	const result: unknown = await afterRawResponse(context);
	if (result instanceof Response) {
		return result;
	}
	if (result !== undefined && result !== null) {
		throw new TypeError("afterRawResponse hook must return a Response or nothing");
	}
	if (context.response.bodyUsed) {
		throw new TypeError(
			"afterRawResponse hook read the response body and returned no Response; read response.clone() instead",
		);
	}
	return context.response;
}

/**
 * Creates a proxy handler for the Vercel AI Gateway.
 *
 * Uses AI SDK V4 Language Model.
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
	beforeRawRequest,
	afterRawResponse,
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
			const resolved = buildUpstreamUrl(baseUrl, path, request.url);
			if (!resolved) {
				return proxyErrorResponse(400, "invalid_request_error", "Invalid path");
			}
			const upstream = resolved.url;

			if (request.method === "GET" || request.method === "HEAD" || request.body === null) {
				return await forwardBodylessRequest(request, upstream, auth, headers);
			}

			// Node adapters give every method but GET and HEAD a body stream, so an empty one is bodyless too
			const text = await request.text();
			if (text === "") {
				return await forwardBodylessRequest(request, upstream, auth, headers);
			}

			// Parse request body
			let requestBody: unknown;
			try {
				requestBody = JSON.parse(text);
			} catch {
				return proxyErrorResponse(400, "invalid_request_error", "Invalid JSON body");
			}

			// Fail closed: only an exact listed path, after "?" and "#" are resolved away, skips the hooks.
			const kind = NON_LANGUAGE_MODEL_PATHS.get(resolved.relativePath);
			const runsHooks = kind === undefined && !READ_PATHS.has(resolved.relativePath);
			// The language model hooks are typed for call options, so they never receive another JSON value.
			if (runsHooks && (beforeRequest || afterResponse || onError) && !isRecord(requestBody)) {
				return proxyErrorResponse(
					400,
					"invalid_request_error",
					"Invalid request body: a language model call must be a JSON object",
				);
			}
			const rawContext = kind && {
				kind,
				path: resolved.relativePath,
				modelId: request.headers.get("ai-model-id") ?? undefined,
			};

			if (beforeRequest && runsHooks) {
				const replaced = await beforeRequest({
					request: requestBody as LanguageModelV4CallOptions,
				});
				// A JavaScript caller can return nothing, such as a hook that only logs.
				if (replaced === undefined || replaced === null) {
					console.error("beforeRequest hook returned no request, sending the original body");
				} else if (!isRecord(replaced)) {
					const message =
						"beforeRequest hook returned an invalid request: the result must be an object";
					console.error(message);
					return proxyErrorResponse(500, "proxy_error", message);
				} else {
					requestBody = replaced;
				}
			}

			if (beforeRawRequest && rawContext) {
				const replaced = await beforeRawRequest({ ...rawContext, request: requestBody });
				if (replaced !== undefined) {
					requestBody = replaced;
				}
			}

			const isStreaming = request.headers.get("ai-language-model-streaming") === "true";

			const res = await fetch(upstream, {
				method: request.method,
				body: JSON.stringify(requestBody),
				duplex: "half",
				signal: request.signal,
				headers: buildRequestHeaders(auth, request, headers),
				redirect: "manual",
			} as RequestInit);

			if (isRedirect(res)) {
				return redirectRefusedResponse(res);
			}

			const response = await forwardUpstreamResponse(
				res,
				requestBody as LanguageModelV4CallOptions,
				isStreaming,
				runsHooks ? { afterResponse, onError } : {},
			);

			if (afterRawResponse && rawContext) {
				return await applyAfterRawResponse(afterRawResponse, {
					...rawContext,
					request: requestBody,
					response,
				});
			}
			return response;
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
