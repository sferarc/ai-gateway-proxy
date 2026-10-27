import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Content,
	LanguageModelV4FinishReason,
	LanguageModelV4Usage,
	SharedV4ProviderMetadata,
	SharedV4Warning,
} from "@ai-sdk/provider";

/**
 * The response body from the AI Gateway for non-streaming requests.
 * For streaming requests, this is aggregated from the stream events.
 */
export type GatewayResponse = {
	content: LanguageModelV4Content[];
	finishReason: LanguageModelV4FinishReason;
	/** `undefined` when a stream ended without a `finish` event, so the usage is unknown. */
	usage: LanguageModelV4Usage | undefined;
	warnings: SharedV4Warning[];
	providerMetadata?: SharedV4ProviderMetadata;
};

/**
 * Why a stream had no `finish` event; the cancel reason is in `cancelReason`.
 */
export type IncompleteStream =
	| { reason: "ended" }
	| { reason: "error"; error: unknown }
	| { reason: "cancelled"; cancelReason?: unknown };

/**
 * Error response from the AI Gateway.
 */
export type GatewayError = {
	error: {
		message: string;
		type: string;
		param?: unknown;
	};
};

/**
 * The kind of a call that is not a language model call, named after the `@ai-sdk/gateway` model it comes from.
 */
export type ModelCallKind =
	| "embedding"
	| "image"
	| "video"
	| "speech"
	| "transcription"
	| "reranking"
	| "decision"
	| "batch";

/**
 * What `beforeRawRequest` receives.
 */
export type RawRequestContext = {
	kind: ModelCallKind;
	/** The upstream path relative to `baseUrl`, such as `embedding-model` or `batch/start`. */
	path: string;
	/** The `ai-model-id` header the client sent, which names the model; a batch names it per request too. */
	modelId: string | undefined;
	/** The parsed JSON body, unchecked. */
	request: unknown;
};

/**
 * What `afterRawResponse` receives.
 */
export type RawResponseContext = RawRequestContext & {
	/**
	 * The response the proxy would send: the upstream status, `content-type` and allowlisted
	 * headers, with the upstream body on success and a `GatewayError` JSON body on failure.
	 * Its body can be read once, so read `response.clone()` to leave it for the client.
	 */
	response: Response;
};

/**
 * Options for creating a gateway proxy.
 */
export type CreateGatewayProxyOptions = {
	/**
	 * Base URL for the AI Gateway. A trailing slash is accepted.
	 * Request paths are resolved under it and cannot leave it; one that would returns 400 Invalid path.
	 * @default "https://ai-gateway.vercel.sh/v1/ai"
	 */
	baseUrl?: string;
	/**
	 * Additional headers to send with requests.
	 * The proxy sets `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version` after these, so they win.
	 * On requests with a body it also sets `content-type`, drops entries naming the model call
	 * (`ai-language-model-*`, `ai-model-id`, `ai-*-model-specification-version`) in favour of the
	 * incoming request's, and lets the incoming `ai-o11y-*`, `idempotency-key` and `accept` override these.
	 */
	headers?: Record<string, string>;
	/**
	 * The name of the catch-all parameter in the route.
	 * @default "segments"
	 * @example
	 * // For Next.js route `app/api/ai/[...path]/route.ts`
	 * createGatewayProxy({ segmentsParam: "path" })
	 */
	segmentsParam?: string;
	/**
	 * Custom function to extract the path from the request.
	 * Use this for frameworks without catch-all route support (e.g., Hono, Express).
	 *
	 * When provided, `segmentsParam` is ignored.
	 *
	 * Return a path relative to `baseUrl`, without a leading `/`.
	 * A path that starts with `/`, contains `://` or has a `.` or `..` segment returns 400 Invalid path.
	 *
	 * @example
	 * // Hono with a base path
	 * createGatewayProxy({
	 *   extractPath: (request) => {
	 *     const url = new URL(request.url);
	 *     return url.pathname.replace(/^\/api\/ai\//, "");
	 *   }
	 * })
	 */
	extractPath?: (request: Request) => string | Promise<string>;
	/**
	 * Called before the request is sent to the gateway.
	 * Allows modification of the request body. Returning `undefined` or `null` sends the
	 * parsed body unchanged and logs an error. Any other result that is not an object, such as
	 * a string or an array, is not sent: the client gets a 500 and the gateway is not called.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 * A body that is JSON but not an object gets a 400 before this or any other language model
	 * hook runs.
	 *
	 * Not called when the path relative to `baseUrl` is exactly one of the paths `@ai-sdk/gateway`
	 * uses for other calls: `embedding-model`, `image-model`, `video-model`, `video-model/start`,
	 * `video-model/status`, `speech-model`, `transcription-model`, `reranking-model`,
	 * `decision-model`, `batch/start`, `batch/status`, `batch/results` and `batch/cancel`.
	 * Every other path runs it, whatever headers the request sends.
	 */
	beforeRequest?: (context: {
		request: LanguageModelV4CallOptions;
	}) => LanguageModelV4CallOptions | Promise<LanguageModelV4CallOptions>;
	/**
	 * Called after a successful response is received from the gateway.
	 * Allows modification of the response body.
	 *
	 * For non-streaming responses, the returned object replaces the JSON body sent to the client.
	 * A result with a missing or wrong-typed field is not sent: the client gets a 500 naming the
	 * field, and on a stream the original finish event is forwarded. `null` stands for an absent
	 * field, and `warnings` may be left out.
	 *
	 * For streaming responses, this is called when the stream completes with
	 * the aggregated response. The content has already been streamed, but you
	 * can modify the finish event metadata (usage, finishReason, providerMetadata).
	 * If the hook throws while handling a stream, the error is logged and the
	 * original finish event is forwarded unchanged.
	 *
	 * A stream that ends, fails or is cancelled before its finish event calls the hook once
	 * with the content received so far, `incomplete` set, `response.usage` undefined and
	 * `response.finishReason` `error` or `other`. Nothing can be rewritten then, so the
	 * returned value is ignored and a throw is logged.
	 *
	 * Not called for an event stream or JSON Lines body answering a request not marked
	 * `ai-language-model-streaming: true`, such as a video model call or batch results, which is
	 * forwarded as is.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 *
	 * Not called when the path relative to `baseUrl` is exactly one of the paths `@ai-sdk/gateway`
	 * uses for other calls: `embedding-model`, `image-model`, `video-model`, `video-model/start`,
	 * `video-model/status`, `speech-model`, `transcription-model`, `reranking-model`,
	 * `decision-model`, `batch/start`, `batch/status`, `batch/results` and `batch/cancel`.
	 * Every other path runs it, whatever headers the request sends.
	 */
	afterResponse?: (context: {
		request: LanguageModelV4CallOptions;
		response: GatewayResponse;
		/** Set only for a stream that did not deliver its `finish` event. */
		incomplete?: IncompleteStream;
	}) => GatewayResponse | Promise<GatewayResponse>;
	/**
	 * Called when the gateway returns an error response.
	 * Allows custom error handling or modification.
	 *
	 * A returned error body is sent as JSON with the upstream status.
	 * A returned `Response` is sent as is.
	 * Returning `undefined`, `null` or a body without a string `error.message` (or with a
	 * non-string `error.type`) logs an error and sends the upstream error body instead.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 *
	 * Not called when the path relative to `baseUrl` is exactly one of the paths `@ai-sdk/gateway`
	 * uses for other calls: `embedding-model`, `image-model`, `video-model`, `video-model/start`,
	 * `video-model/status`, `speech-model`, `transcription-model`, `reranking-model`,
	 * `decision-model`, `batch/start`, `batch/status`, `batch/results` and `batch/cancel`.
	 * Every other path runs it, whatever headers the request sends.
	 */
	onError?: (context: {
		request: LanguageModelV4CallOptions;
		error: GatewayError;
		status: number;
	}) => GatewayError | Response | Promise<GatewayError | Response>;
	/**
	 * Called before a call that is not a language model call is sent to the gateway: a request
	 * with a body whose path relative to `baseUrl` is exactly `embedding-model`, `image-model`,
	 * `video-model`, `video-model/start`, `speech-model`, `transcription-model`,
	 * `reranking-model`, `decision-model` or `batch/start`. Job reads (`video-model/status` and
	 * `batch/status`, `batch/results`, `batch/cancel`) run no hook.
	 *
	 * A returned value replaces the body sent upstream; `undefined` sends the body as is.
	 */
	beforeRawRequest?: (context: RawRequestContext) => unknown;
	/**
	 * Called with the response to a call `beforeRawRequest` would run for, on success and on an
	 * upstream error status, but not on a redirect, which is answered with a 502, nor when the
	 * upstream request fails.
	 *
	 * A returned `Response` is sent instead. Returning nothing sends `response`, which must then
	 * be unread; a hook that read it without returning a `Response`, or returned anything else,
	 * is a 500.
	 */
	afterRawResponse?: (
		context: RawResponseContext,
	) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Route handler function signature for the gateway proxy.
 * Compatible with Next.js App Router and other frameworks.
 * Takes a Fetch API `Request`, not a Node or Express request object.
 */
export type CreateGatewayProxyFn = (
	request: Request,
	context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

/**
 * Result of createGatewayProxy - a handler function with HTTP method exports.
 */
export type CreateGatewayProxyResult = CreateGatewayProxyFn & {
	GET: CreateGatewayProxyFn;
	POST: CreateGatewayProxyFn;
	PUT: CreateGatewayProxyFn;
	DELETE: CreateGatewayProxyFn;
	PATCH: CreateGatewayProxyFn;
};
