export type CallerUsage = { calls: number; inputTokens: number; outputTokens: number };

export const OUTPUT_TOKEN_LIMIT = 20_000;

// In memory, so it resets on restart and is not shared between server instances.
const usageByCaller = new Map<string, CallerUsage>();

export function usageFor(caller: string): CallerUsage {
	return usageByCaller.get(caller) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
}

// Charged before the call, so concurrent calls cannot each spend the same remainder.
export function reserveOutputTokens(caller: string, requested: number): number | undefined {
	const usage = usageFor(caller);
	const remaining = OUTPUT_TOKEN_LIMIT - usage.outputTokens;
	if (remaining <= 0) return undefined;
	const cap = Math.max(0, Math.min(requested, remaining));
	usageByCaller.set(caller, {
		...usage,
		calls: usage.calls + 1,
		outputTokens: usage.outputTokens + cap,
	});
	return cap;
}

// Without a reported output count, as for a stream cancelled before finish, the call keeps its cap.
export function settleUsage(
	caller: string,
	reserved: number,
	reported: { inputTokens?: number; outputTokens?: number },
): void {
	const usage = usageFor(caller);
	usageByCaller.set(caller, {
		...usage,
		inputTokens: usage.inputTokens + (reported.inputTokens ?? 0),
		outputTokens: usage.outputTokens - reserved + (reported.outputTokens ?? reserved),
	});
}
