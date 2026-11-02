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

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
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
const NULL_BODY_STATUS = new Set([204, 205]);
// AI SDK clients retry 408, 409, 429 and any 5xx, which would pay for the answered call again.
const ANSWERED_CALL_FAILURE_STATUS = 424;
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

type ProxyErrorType = "invalid_request_error" | "proxy_error";

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

		return passThroughResponse(res);
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
 * Retypes a gateway `authentication_error` as a `proxy_error` naming the proxy's credential, since
 * the client's own credential never reaches the gateway and `@ai-sdk/gateway` would replace the
 * message with advice about it.
 */
function retypeProxyCredentialError(upstreamError: GatewayError): GatewayError {
	if (upstreamError.error.type !== "authentication_error") {
		return upstreamError;
	}
	return {
		...upstreamError,
		error: {
			...upstreamError.error,
			message: `AI Gateway rejected the proxy's credential: ${upstreamError.error.message}`,
			type: "proxy_error",
		},
	};
}

/**
 * Builds response headers with the given content type, if any, plus the allowlisted upstream headers.
 */
function responseHeaders(res: Response, contentType?: string): Headers {
	const headers = new Headers(contentType ? { "content-type": contentType } : undefined);
	for (const [name, value] of res.headers) {
		if (FORWARDED_RESPONSE_HEADER.test(name)) {
			headers.set(name, value);
		}
	}
	return headers;
}

/**
 * Sends the upstream body unread, with its `content-type` and the allowlisted upstream headers.
 */
function passThroughResponse(res: Response): Response {
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, res.headers.get("content-type") ?? "application/json"),
	});
}

/**
 * Runs onError and returns the body or Response to send, falling back to the upstream error body.
 */
async function runOnError(
	onError: NonNullable<CreateGatewayProxyOptions["onError"]>,
	res: Response,
	upstreamError: GatewayError,
	requestBody: LanguageModelV4CallOptions,
): Promise<GatewayError | Response> {
	let result: unknown;
	try {
		result = await onError({ request: requestBody, error: upstreamError, status: res.status });
	} catch (error) {
		// A 500 would hide the upstream status and its retry-after, and make a 400 look retryable.
		console.error("onError hook failed, forwarding the upstream error body:", error);
		return upstreamError;
	}

	if (result instanceof Response) {
		return result;
	}
	// A JavaScript caller can return nothing, such as a hook that only logs.
	if (result === undefined || result === null) {
		console.error("onError hook returned no response, forwarding the upstream error body");
		return upstreamError;
	}
	const problem = gatewayErrorProblem(result);
	if (problem) {
		console.error(
			`onError hook returned an invalid error, forwarding the upstream error body: ${problem}`,
		);
		return upstreamError;
	}
	return result as GatewayError;
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
	const errorBody = onError
		? await runOnError(onError, res, upstreamError, requestBody)
		: upstreamError;
	if (errorBody instanceof Response) {
		return errorBody;
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
	signal?: AbortSignal,
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
	const transformedStream = createStreamTransformer(res.body, requestBody, afterResponse, signal);

	return new Response(transformedStream, {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, contentType),
	});
}

/**
 * Runs afterResponse on a non-streaming JSON response from the gateway.
 * The gateway has answered, and billed, the call, so a failure here gets a status clients do not retry.
 */
async function handleJsonResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
	afterResponse: NonNullable<CreateGatewayProxyOptions["afterResponse"]>,
	signal: AbortSignal,
): Promise<Response> {
	try {
		return await runAfterResponse(res, requestBody, afterResponse);
	} catch (error) {
		// The handler answers a client abort with 499.
		if (signal.aborted) {
			throw error;
		}
		console.error("AI Gateway proxy failed after the gateway answered:", error);
		return proxyErrorResponse(
			ANSWERED_CALL_FAILURE_STATUS,
			"proxy_error",
			"Error processing the AI Gateway response",
		);
	}
}

async function runAfterResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
	afterResponse: NonNullable<CreateGatewayProxyOptions["afterResponse"]>,
): Promise<Response> {
	const parsed: unknown = await res.json();
	if (!isRecord(parsed)) {
		throw new TypeError("AI Gateway returned a successful body that is not a JSON object");
	}
	let responseBody = parsed as GatewayResponse;
	// Read before the hook, which may delete it from the object it receives.
	const upstreamUsage = responseBody.usage;

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
			return proxyErrorResponse(ANSWERED_CALL_FAILURE_STATUS, "proxy_error", message);
		}
		// As on a stream's finish event: the AI SDK reads usage from every generate result, so it cannot be stripped.
		responseBody = { ...modified, usage: modified.usage ?? upstreamUsage };
	}

	return new Response(JSON.stringify(responseBody), {
		status: res.status,
		statusText: res.statusText,
		headers: responseHeaders(res, "application/json"),
	});
}

type LanguageModelHooks = Pick<CreateGatewayProxyOptions, "afterResponse" | "onError">;

/**
 * Wraps the hooks so each call also receives the model id, which the stream transformer does not know.
 */
function withModelId(
	{ afterResponse, onError }: LanguageModelHooks,
	modelId: string | undefined,
): LanguageModelHooks {
	return {
		afterResponse: afterResponse && ((context) => afterResponse({ ...context, modelId })),
		onError: onError && ((context) => onError({ ...context, modelId })),
	};
}

/**
 * Builds the client response for a non-redirect upstream response, running the language model hooks given.
 */
async function forwardUpstreamResponse(
	res: Response,
	requestBody: LanguageModelV4CallOptions,
	isStreaming: boolean,
	{ afterResponse, onError }: LanguageModelHooks,
	signal: AbortSignal,
): Promise<Response> {
	if (!res.ok) {
		const errorBody = retypeProxyCredentialError(await parseErrorBody(res));
		return await createErrorResponse(res, errorBody, requestBody, onError);
	}

	// A 204 or 205 has no body to parse or hand to afterResponse, and a Response with it cannot carry one.
	if (NULL_BODY_STATUS.has(res.status)) {
		return new Response(null, {
			status: res.status,
			statusText: res.statusText,
			headers: responseHeaders(res),
		});
	}

	if (isStreaming) {
		return handleStreamingResponse(res, requestBody, afterResponse, signal);
	}

	// Only afterResponse reads a success body; without it, or for an event stream or JSON Lines, it streams through.
	if (!afterResponse || STREAM_CONTENT_TYPE.test(res.headers.get("content-type") ?? "")) {
		return passThroughResponse(res);
	}

	return await handleJsonResponse(res, requestBody, afterResponse, signal);
}

/**
 * Cancels a body nothing will read, since an unread fetch body holds its upstream connection.
 */
function discardUnreadBody(response: Response): void {
	if (response.body && !response.bodyUsed && !response.body.locked) {
		response.body.cancel().catch(() => {});
	}
}

/**
 * Runs afterRawResponse and returns the response to send.
 */
async function applyAfterRawResponse(
	afterRawResponse: NonNullable<CreateGatewayProxyOptions["afterRawResponse"]>,
	context: RawResponseContext,
): Promise<Response> {
	let result: unknown;
	try {
		result = await afterRawResponse(context);
	} catch (error) {
		discardUnreadBody(context.response);
		throw error;
	}
	if (result instanceof Response) {
		// A replacement built on response.body still needs it.
		if (result.body !== context.response.body) {
			discardUnreadBody(context.response);
		}
		return result;
	}
	if (result !== undefined && result !== null) {
		discardUnreadBody(context.response);
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
			// Not authentication_error: @ai-sdk/gateway replaces that message with advice about the client's own key.
			return proxyErrorResponse(
				500,
				"proxy_error",
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

			// A hook can replace or mutate the parsed body, so only then is it serialised again.
			let bodyHandedToHook = false;

			// The body does not name the model; @ai-sdk/gateway sends it in this header.
			const modelId = request.headers.get("ai-language-model-id") ?? undefined;

			if (beforeRequest && runsHooks) {
				bodyHandedToHook = true;
				const replaced = await beforeRequest({
					request: requestBody as LanguageModelV4CallOptions,
					modelId,
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
				bodyHandedToHook = true;
				const replaced = await beforeRawRequest({ ...rawContext, request: requestBody });
				// null, like undefined, keeps the body rather than sending the literal null upstream.
				if (replaced !== undefined && replaced !== null) {
					requestBody = replaced;
				}
			}

			const isStreaming = request.headers.get("ai-language-model-streaming") === "true";

			const res = await fetch(upstream, {
				method: request.method,
				body: bodyHandedToHook ? JSON.stringify(requestBody) : text,
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
				runsHooks ? withModelId({ afterResponse, onError }, modelId) : {},
				request.signal,
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
