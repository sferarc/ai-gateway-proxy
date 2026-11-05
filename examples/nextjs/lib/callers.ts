// Demo tokens standing in for your own session check; anyone who reads this file can use them.
const callersByToken = new Map([
	["demo-token-alice", "alice"],
	["demo-token-bob", "bob"],
]);

export function callerFor(request: Request): string | undefined {
	const authorization = request.headers.get("authorization");
	const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
	return token ? callersByToken.get(token) : undefined;
}

export function signInRequired(): Response {
	// Not authentication_error: @ai-sdk/gateway replaces that message with advice about gateway keys.
	return Response.json(
		{ error: { message: "Sign in to use the AI route", type: "invalid_request_error" } },
		{ status: 401 },
	);
}
