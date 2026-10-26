function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON has no undefined, so null stands in for it wherever the type allows undefined.
function isNullish(value: unknown): value is null | undefined {
	return value === undefined || value === null;
}

function tokenCountsProblem(name: string, value: unknown, fields: string[]): string | undefined {
	if (!isRecord(value)) {
		return `${name} must be an object`;
	}
	for (const field of fields) {
		if (!isNullish(value[field]) && typeof value[field] !== "number") {
			return `${name}.${field} must be a number or undefined`;
		}
	}
	return undefined;
}

/**
 * Returns why an `afterResponse` result is not a `GatewayResponse`, or undefined when it is one.
 */
export function gatewayResponseProblem(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return "the result must be an object";
	}

	const { content, finishReason, usage, warnings, providerMetadata } = value;
	if (!Array.isArray(content)) {
		return "content must be an array";
	}
	if (!content.every((part) => isRecord(part) && typeof part.type === "string")) {
		return "content must hold objects with a string type";
	}

	if (!isRecord(finishReason) || typeof finishReason.unified !== "string") {
		return "finishReason must be an object with a string unified";
	}
	if (!isNullish(finishReason.raw) && typeof finishReason.raw !== "string") {
		return "finishReason.raw must be a string or undefined";
	}

	if (!isNullish(usage)) {
		if (!isRecord(usage)) {
			return "usage must be an object or undefined";
		}
		const problem =
			tokenCountsProblem("usage.inputTokens", usage.inputTokens, [
				"total",
				"noCache",
				"cacheRead",
				"cacheWrite",
			]) ??
			tokenCountsProblem("usage.outputTokens", usage.outputTokens, ["total", "text", "reasoning"]);
		if (problem) {
			return problem;
		}
	}

	// @ai-sdk/gateway reads a missing warnings field as none, so only a wrong type is rejected.
	if (!isNullish(warnings) && !Array.isArray(warnings)) {
		return "warnings must be an array";
	}
	if (!isNullish(providerMetadata) && !isRecord(providerMetadata)) {
		return "providerMetadata must be an object or undefined";
	}

	return undefined;
}
