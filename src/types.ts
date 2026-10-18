import type {
	LanguageModelV3CallOptions,
	LanguageModelV3Content,
	LanguageModelV3FinishReason,
	LanguageModelV3Usage,
	SharedV3ProviderMetadata,
	SharedV3Warning,
} from "@ai-sdk/provider";

/**
 * The response body from the AI Gateway for non-streaming requests.
 * For streaming requests, this is aggregated from the stream events.
 */
export type GatewayResponse = {
	content: LanguageModelV3Content[];
	finishReason: LanguageModelV3FinishReason;
	usage: LanguageModelV3Usage;
	warnings: SharedV3Warning[];
	providerMetadata?: SharedV3ProviderMetadata;
};

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
	 * Allows modification of the request body.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 */
	beforeRequest?: (context: {
		request: LanguageModelV3CallOptions;
	}) => LanguageModelV3CallOptions | Promise<LanguageModelV3CallOptions>;
	/**
	 * Called after a successful response is received from the gateway.
	 * Allows modification of the response body.
	 *
	 * For non-streaming responses, the returned object replaces the JSON body sent to the client.
	 *
	 * For streaming responses, this is called when the stream completes with
	 * the aggregated response. The content has already been streamed, but you
	 * can modify the finish event metadata (usage, finishReason, providerMetadata).
	 * If the hook throws while handling a stream, the error is logged and the
	 * original finish event is forwarded unchanged.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 */
	afterResponse?: (context: {
		request: LanguageModelV3CallOptions;
		response: GatewayResponse;
	}) => GatewayResponse | Promise<GatewayResponse>;
	/**
	 * Called when the gateway returns an error response.
	 * Allows custom error handling or modification.
	 *
	 * A returned error body is sent as JSON with the upstream status.
	 * A returned `Response` is sent as is.
	 *
	 * Not called for GET, HEAD or other requests without a body, which are forwarded as is.
	 */
	onError?: (context: {
		request: LanguageModelV3CallOptions;
		error: GatewayError;
		status: number;
	}) => GatewayError | Response | Promise<GatewayError | Response>;
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
