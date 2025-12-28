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
	/** Base URL for the AI Gateway. Defaults to Vercel's gateway. */
	baseUrl?: string;
	/** Additional headers to send with requests. */
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
	 */
	beforeRequest?: (context: {
		request: LanguageModelV3CallOptions;
	}) => LanguageModelV3CallOptions | Promise<LanguageModelV3CallOptions>;
	/**
	 * Called after a successful response is received from the gateway.
	 * Allows modification of the response body.
	 *
	 * For streaming responses, this is called when the stream completes with
	 * the aggregated response. The content has already been streamed, but you
	 * can modify the finish event metadata (usage, finishReason, providerMetadata).
	 */
	afterResponse?: (context: {
		request: LanguageModelV3CallOptions;
		response: GatewayResponse;
	}) => GatewayResponse | Promise<GatewayResponse>;
	/**
	 * Called when the gateway returns an error response.
	 * Allows custom error handling or modification.
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
