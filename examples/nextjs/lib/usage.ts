export type CallerUsage = { calls: number; inputTokens: number; outputTokens: number };

export const OUTPUT_TOKEN_LIMIT = 20_000;

// In memory, so it resets on restart and is not shared between server instances.
const usageByCaller = new Map<string, CallerUsage>();

export function usageFor(caller: string): CallerUsage {
	return usageByCaller.get(caller) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
}

export function recordUsage(caller: string, inputTokens = 0, outputTokens = 0): void {
	const usage = usageFor(caller);
	usageByCaller.set(caller, {
		calls: usage.calls + 1,
		inputTokens: usage.inputTokens + inputTokens,
		outputTokens: usage.outputTokens + outputTokens,
	});
}
