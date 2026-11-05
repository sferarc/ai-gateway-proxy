import { createGatewayProxy } from "ai-gateway-proxy";
import { callerFor, signInRequired } from "../../../../lib/callers";
import { OUTPUT_TOKEN_LIMIT, recordUsage, usageFor } from "../../../../lib/usage";

const proxy = createGatewayProxy({
	beforeRequest: ({ request, incomingRequest }) => {
		const caller = callerFor(incomingRequest);
		if (!caller) return signInRequired();
		const remaining = OUTPUT_TOKEN_LIMIT - usageFor(caller).outputTokens;
		if (remaining <= 0) {
			// 403 rather than 429: the AI SDK retries a 429, which cannot succeed here.
			return Response.json(
				{ error: { message: "Output token limit reached", type: "invalid_request_error" } },
				{ status: 403 },
			);
		}
		return { ...request, maxOutputTokens: Math.min(request.maxOutputTokens ?? 1024, remaining) };
	},
	afterResponse: ({ response, incomingRequest }) => {
		const caller = incomingRequest && callerFor(incomingRequest);
		if (caller) {
			// usage is undefined when a stream ended before its finish event.
			recordUsage(caller, response.usage?.inputTokens.total, response.usage?.outputTokens.total);
		}
		return response;
	},
});

async function handler(request: Request, context: { params: Promise<{ segments: string[] }> }) {
	if (!callerFor(request)) return signInRequired();
	return proxy(request, context);
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
