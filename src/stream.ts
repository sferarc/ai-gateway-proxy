import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Content,
	LanguageModelV4FinishReason,
	LanguageModelV4StreamPart,
	LanguageModelV4Text,
	LanguageModelV4Usage,
	SharedV4ProviderMetadata,
	SharedV4Warning,
} from "@ai-sdk/provider";
import { EventSourceParserStream } from "@ai-sdk/provider-utils";
import { gatewayResponseProblem } from "./hook-result";
import type { CreateGatewayProxyOptions, GatewayResponse, IncompleteStream } from "./types";

/**
 * Aggregator for collecting stream content.
 * Tracks text deltas, reasoning, tool calls, and other content to build the final GatewayResponse.
 *
 * Uses AI SDK V4 protocol types.
 * @see https://github.com/vercel/ai/blob/main/packages/provider/src/language-model/v4/language-model-v4-stream-part.ts
 */
export class StreamContentAggregator {
	private content: LanguageModelV4Content[] = [];
	private warnings: SharedV4Warning[] = [];

	// Open text and reasoning blocks by id. Each block already holds its slot in `content`.
	private textContent = new Map<string, LanguageModelV4Text>();
	private reasoningContent = new Map<string, { type: "reasoning"; text: string }>();

	private finishReason: LanguageModelV4FinishReason = {
		unified: "other",
		raw: undefined,
	};

	private usage: LanguageModelV4Usage | undefined;

	private providerMetadata: SharedV4ProviderMetadata | undefined;

	/**
	 * Process a stream part and update aggregated state.
	 * Uses LanguageModelV4StreamPart type from @ai-sdk/provider.
	 *
	 * @see https://github.com/vercel/ai/blob/main/packages/provider/src/language-model/v4/language-model-v4-stream-part.ts
	 */
	process(part: LanguageModelV4StreamPart): void {
		switch (part.type) {
			case "stream-start":
				// The part comes off the wire, so a missing or malformed warnings field adds none.
				if (Array.isArray(part.warnings)) {
					this.warnings.push(...part.warnings);
				}
				break;

			case "text-start":
				this.openText(part.id);
				break;

			case "text-delta":
				(this.textContent.get(part.id) ?? this.openText(part.id)).text += part.delta;
				break;

			case "text-end": {
				const block = this.textContent.get(part.id);
				if (block && Array.isArray(part.citations)) {
					block.citations = part.citations;
				}
				this.textContent.delete(part.id);
				break;
			}

			case "reasoning-start":
				this.openReasoning(part.id);
				break;

			case "reasoning-delta":
				(this.reasoningContent.get(part.id) ?? this.openReasoning(part.id)).text += part.delta;
				break;

			case "reasoning-end":
				this.reasoningContent.delete(part.id);
				break;

			case "tool-input-start":
			case "tool-input-delta":
			case "tool-input-end":
				// Tool input is streamed incrementally but we wait for the complete tool-call event
				break;

			case "tool-call":
				this.content.push(part);
				break;

			case "tool-result":
				this.content.push(part);
				break;

			case "tool-approval-request":
				this.content.push(part);
				break;

			case "file":
			case "custom":
			case "reasoning-file":
				this.content.push(part);
				break;

			case "source":
				this.content.push(part);
				break;

			case "finish":
				this.textContent.clear();
				this.reasoningContent.clear();
				this.finishReason = part.finishReason;
				this.usage = part.usage;
				this.providerMetadata = part.providerMetadata;
				break;
		}
	}

	private openText(id: string) {
		const block: LanguageModelV4Text = { type: "text", text: "" };
		this.textContent.set(id, block);
		this.content.push(block);
		return block;
	}

	private openReasoning(id: string) {
		const block = { type: "reasoning" as const, text: "" };
		this.reasoningContent.set(id, block);
		this.content.push(block);
		return block;
	}

	/**
	 * Get the aggregated response. Before a `finish` part, `usage` is undefined and
	 * `finishReason` is `other`.
	 */
	getResponse(): GatewayResponse {
		return {
			content: this.content,
			finishReason: this.finishReason,
			usage: this.usage,
			warnings: this.warnings,
			providerMetadata: this.providerMetadata,
		};
	}
}

/**
 * Encodes event data as an SSE event. The parser joins multi-line data with "\n",
 * so each line needs its own `data:` field to reach the client intact.
 */
function sseEvent(data: string): string {
	return `${data
		.split("\n")
		.map((line) => `data: ${line}`)
		.join("\n")}\n\n`;
}

/**
 * Creates a transform stream that:
 * 1. Passes through all SSE events immediately
 * 2. Aggregates content using StreamContentAggregator
 * 3. Calls afterResponse when finish event is received, or once with partial content if the
 *    stream ends, fails or is cancelled first
 * 4. Modifies the finish event based on afterResponse result
 *
 * Uses EventSourceParserStream from @ai-sdk/provider-utils for SSE parsing.
 * EventSourceParserStream is re-exported from the eventsource-parser package.
 * @see https://github.com/vercel/ai/blob/main/packages/provider-utils/src/parse-json-event-stream.ts
 * @see https://github.com/rexxars/eventsource-parser
 */
export function createStreamTransformer(
	body: ReadableStream<Uint8Array>,
	requestBody: LanguageModelV4CallOptions,
	afterResponse: NonNullable<CreateGatewayProxyOptions["afterResponse"]>,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const aggregator = new StreamContentAggregator();

	const eventStream = body
		.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
		.pipeThrough(new EventSourceParserStream());
	const reader = eventStream.getReader();
	let cancelled = false;
	let finishSeen = false;
	let incompleteReported = false;
	let warnedNonJson = false;

	/**
	 * Returns the data to forward for one upstream event, calling afterResponse on finish.
	 */
	async function transformEvent(data: string): Promise<string> {
		// Handle DONE marker (end of stream)
		if (data === "DONE" || data === "[DONE]") {
			return data;
		}

		// Parse the JSON event data. Data that is not a JSON object, such as `null`, is not a stream
		// part either, so it passes through like non-JSON data rather than reaching the aggregator.
		let json: unknown;
		try {
			json = JSON.parse(data);
		} catch {}
		if (typeof json !== "object" || json === null) {
			if (!warnedNonJson) {
				warnedNonJson = true;
				console.warn("upstream stream event is not a JSON object, passing it through unparsed");
			}
			return data;
		}
		const parsed = json as LanguageModelV4StreamPart;

		// Track content for aggregation
		aggregator.process(parsed);

		// Pass through every event but finish unchanged
		if (parsed.type !== "finish") {
			return data;
		}

		finishSeen = true;
		let modifiedResponse: GatewayResponse;
		try {
			modifiedResponse = await afterResponse({
				request: requestBody,
				response: aggregator.getResponse(),
			});
		} catch (error) {
			console.error("afterResponse hook failed, forwarding original finish event:", error);
			return data;
		}
		const problem = gatewayResponseProblem(modifiedResponse);
		if (problem) {
			console.error(
				`afterResponse hook returned an invalid response, forwarding original finish event: ${problem}`,
			);
			return data;
		}
		const modifiedFinish: LanguageModelV4StreamPart = {
			type: "finish",
			finishReason: modifiedResponse.finishReason,
			usage: modifiedResponse.usage ?? parsed.usage,
			providerMetadata: modifiedResponse.providerMetadata ?? undefined,
		};
		return JSON.stringify(modifiedFinish);
	}

	// No finish event is left to rewrite, so the result is ignored and a throw only logged.
	async function reportIncomplete(incomplete: IncompleteStream): Promise<void> {
		if (finishSeen || incompleteReported) {
			return;
		}
		incompleteReported = true;
		const response = aggregator.getResponse();
		if (incomplete.reason === "error") {
			response.finishReason = { unified: "error", raw: undefined };
		}
		try {
			await afterResponse({ request: requestBody, response, incomplete });
		} catch (error) {
			console.error("afterResponse hook failed on an unfinished stream:", error);
		}
	}

	// Reading in pull rather than start keeps backpressure: one upstream event per client read,
	// so a slow client does not make the proxy buffer the whole response.
	return new ReadableStream({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					// Awaited before close so a serverless handler stays alive until the hook finishes.
					if (!cancelled) {
						await reportIncomplete({ reason: "ended" });
					}
					controller.close();
					reader.releaseLock();
					return;
				}

				controller.enqueue(encoder.encode(sseEvent(await transformEvent(value.data))));
			} catch (error) {
				if (!cancelled) {
					console.error("upstream stream failed, erroring the client stream:", error);
					await reportIncomplete({ reason: "error", error });
				}
				controller.error(error);
				reader.releaseLock();
			}
		},
		async cancel(reason) {
			cancelled = true;
			const upstream = reader.cancel(reason);
			upstream.catch(() => {});
			await reportIncomplete({ reason: "cancelled", cancelReason: reason });
			return upstream;
		},
	});
}
