import { createGatewayProxy } from "ai-gateway-proxy";
import { callerFor, signInRequired } from "../../../../lib/callers";
import { reserveOutputTokens, settleUsage } from "../../../../lib/usage";

// 403 rather than 429: the AI SDK retries a 429, which cannot succeed here.
function refused(message: string): Response {
	return Response.json({ error: { message, type: "invalid_request_error" } }, { status: 403 });
}

const proxy = createGatewayProxy({
	beforeRequest: ({ request, incomingRequest }) => {
		const caller = callerFor(incomingRequest);
		if (!caller) return signInRequired();
		const cap = reserveOutputTokens(caller, request.maxOutputTokens ?? 1024);
		if (cap === undefined) return refused("Output token limit reached");
		return { ...request, maxOutputTokens: cap };
	},
	afterResponse: ({ request, response, incomingRequest }) => {
		const caller = incomingRequest && callerFor(incomingRequest);
		if (caller) {
			// usage is undefined when a stream ended before its finish event, so the cap stays charged.
			settleUsage(caller, request.maxOutputTokens ?? 0, {
				inputTokens: response.usage?.inputTokens.total,
				outputTokens: response.usage?.outputTokens.total,
			});
		}
		return response;
	},
	onError: ({ request, error, incomingRequest }) => {
		const caller = incomingRequest && callerFor(incomingRequest);
		// An error status carries no generation, so the reserved cap is released.
		if (caller) settleUsage(caller, request.maxOutputTokens ?? 0, { outputTokens: 0 });
		return error;
	},
	// Embedding, image, video and the other calls are not metered, so the route refuses them.
	beforeRawRequest: ({ kind }) => refused(`This route does not serve ${kind} calls`),
});

async function handler(request: Request, context: { params: Promise<{ segments: string[] }> }) {
	if (!callerFor(request)) return signInRequired();
	return proxy(request, context);
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
