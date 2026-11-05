import { callerFor, signInRequired } from "../../../lib/callers";
import { OUTPUT_TOKEN_LIMIT, usageFor } from "../../../lib/usage";

export function GET(request: Request) {
	const caller = callerFor(request);
	if (!caller) return signInRequired();
	return Response.json({ caller, limit: OUTPUT_TOKEN_LIMIT, ...usageFor(caller) });
}
