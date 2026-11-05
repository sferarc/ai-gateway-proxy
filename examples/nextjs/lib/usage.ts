export type CallerUsage = { calls: number; inputTokens: number; outputTokens: number };

export const OUTPUT_TOKEN_LIMIT = 20_000;

// In memory, so it resets on restart and is not shared between server instances.
const usageByCaller = new Map<string, CallerUsage>();

export function usageFor(caller: string): CallerUsage {
	return usageByCaller.get(caller) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
}

export function isTokenCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

// A total that is not a whole count would make every later limit check false, so it is refused.
function store(caller: string, usage: CallerUsage): void {
	for (const total of [usage.calls, usage.inputTokens, usage.outputTokens]) {
		if (!Number.isSafeInteger(total) || total < 0) {
			throw new RangeError(`Refusing to store a usage total of ${total} for ${caller}`);
		}
	}
	usageByCaller.set(caller, usage);
}

// Charged before the call, so concurrent calls cannot each spend the same remainder.
export function reserveOutputTokens(
	caller: string,
	requested: number | undefined,
): number | undefined {
	if (requested !== undefined && !isTokenCount(requested)) {
		throw new RangeError(`Refusing to reserve ${requested} output tokens`);
	}
	const usage = usageFor(caller);
	const remaining = OUTPUT_TOKEN_LIMIT - usage.outputTokens;
	if (remaining <= 0) return undefined;
	const cap = Math.min(requested ?? remaining, remaining);
	store(caller, { ...usage, calls: usage.calls + 1, outputTokens: usage.outputTokens + cap });
	return cap;
}

// Without a reported output count, as for a stream cancelled before finish, the call keeps its cap.
export function settleUsage(
	caller: string,
	reserved: number,
	reported: { inputTokens?: number; outputTokens?: number },
): void {
	const usage = usageFor(caller);
	store(caller, {
		...usage,
		inputTokens: usage.inputTokens + (reported.inputTokens ?? 0),
		outputTokens: usage.outputTokens - reserved + (reported.outputTokens ?? reserved),
	});
}
