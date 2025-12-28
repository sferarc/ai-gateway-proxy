import type {
	LanguageModelV3CallOptions,
	LanguageModelV3Content,
	LanguageModelV3FinishReason,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
	SharedV3ProviderMetadata,
	SharedV3Warning,
} from "@ai-sdk/provider";
import { EventSourceParserStream } from "@ai-sdk/provider-utils";
import type { CreateGatewayProxyOptions, GatewayResponse } from "./types";

/**
 * Aggregator for collecting stream content.
 * Tracks text deltas, reasoning, tool calls, and other content to build the final GatewayResponse.
 *
 * Uses AI SDK V3 protocol types.
 * @see https://github.com/vercel/ai/blob/main/packages/provider/src/language-model/v3/language-model-v3-stream-part.ts
 */
export class StreamContentAggregator {
	private content: LanguageModelV3Content[] = [];
	private warnings: SharedV3Warning[] = [];

	// Text content being built (keyed by id)
	private textContent = new Map<string, { type: "text"; text: string }>();

	// Reasoning content being built (keyed by id)
	private reasoningContent = new Map<string, { type: "reasoning"; text: string }>();

	private finishReason: LanguageModelV3FinishReason = {
		unified: "stop",
		raw: undefined,
	};

	private usage: LanguageModelV3Usage = {
		inputTokens: {
			total: undefined,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: {
			total: undefined,
			text: undefined,
			reasoning: undefined,
		},
	};

	private providerMetadata: SharedV3ProviderMetadata | undefined;

	/**
	 * Process a stream part and update aggregated state.
	 * Uses LanguageModelV3StreamPart type from @ai-sdk/provider.
	 *
	 * @see https://github.com/vercel/ai/blob/main/packages/provider/src/language-model/v3/language-model-v3-stream-part.ts
	 */
	process(part: LanguageModelV3StreamPart): void {
		switch (part.type) {
			case "stream-start":
				this.warnings.push(...part.warnings);
				break;

			case "text-start":
				this.textContent.set(part.id, { type: "text", text: "" });
				break;

			case "text-delta":
				{
					const text = this.textContent.get(part.id);
					if (text) {
						text.text += part.delta;
					}
				}
				break;

			case "text-end":
				{
					const text = this.textContent.get(part.id);
					if (text) {
						this.content.push(text);
						this.textContent.delete(part.id);
					}
				}
				break;

			case "reasoning-start":
				this.reasoningContent.set(part.id, { type: "reasoning", text: "" });
				break;

			case "reasoning-delta":
				{
					const reasoning = this.reasoningContent.get(part.id);
					if (reasoning) {
						reasoning.text += part.delta;
					}
				}
				break;

			case "reasoning-end":
				{
					const reasoning = this.reasoningContent.get(part.id);
					if (reasoning) {
						this.content.push(reasoning);
						this.reasoningContent.delete(part.id);
					}
				}
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
				this.content.push(part);
				break;

			case "source":
				this.content.push(part);
				break;

			case "finish":
				// Finalize any remaining content
				for (const [, text] of this.textContent) {
					this.content.push(text);
				}
				this.textContent.clear();

				for (const [, reasoning] of this.reasoningContent) {
					this.content.push(reasoning);
				}
				this.reasoningContent.clear();

				this.finishReason = part.finishReason;
				this.usage = part.usage;
				this.providerMetadata = part.providerMetadata;
				break;
		}
	}

	/**
	 * Get the aggregated response.
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
 * Creates a transform stream that:
 * 1. Passes through all SSE events immediately
 * 2. Aggregates content using StreamContentAggregator
 * 3. Calls afterResponse when finish event is received
 * 4. Modifies the finish event based on afterResponse result
 *
 * Uses EventSourceParserStream from @ai-sdk/provider-utils for SSE parsing.
 * EventSourceParserStream is re-exported from the eventsource-parser package.
 * @see https://github.com/vercel/ai/blob/main/packages/provider-utils/src/parse-json-event-stream.ts
 * @see https://github.com/rexxars/eventsource-parser
 */
export function createStreamTransformer(
	body: ReadableStream<Uint8Array>,
	requestBody: LanguageModelV3CallOptions,
	afterResponse: NonNullable<CreateGatewayProxyOptions["afterResponse"]>,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const aggregator = new StreamContentAggregator();

	// Use EventSourceParserStream for SSE parsing (re-exported from eventsource-parser via @ai-sdk/provider-utils)
	const eventStream = body
		.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
		.pipeThrough(new EventSourceParserStream());

	return new ReadableStream({
		async start(controller) {
			const reader = eventStream.getReader();

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const { data } = value;

					// Handle DONE marker (end of stream)
					if (data === "DONE" || data === "[DONE]") {
						controller.enqueue(encoder.encode(`data: ${data}\n\n`));
						continue;
					}

					// Parse the JSON event data
					let parsed: LanguageModelV3StreamPart;
					try {
						parsed = JSON.parse(data);
					} catch {
						// Not valid JSON, pass through as-is
						controller.enqueue(encoder.encode(`data: ${data}\n\n`));
						continue;
					}

					// Track content for aggregation
					aggregator.process(parsed);

					// Handle finish event specially - call afterResponse hook
					if (parsed.type === "finish") {
						const modifiedResponse = await afterResponse({
							request: requestBody,
							response: aggregator.getResponse(),
						});

						// Emit modified finish event
						const modifiedFinish: LanguageModelV3StreamPart = {
							type: "finish",
							finishReason: modifiedResponse.finishReason,
							usage: modifiedResponse.usage,
							providerMetadata: modifiedResponse.providerMetadata,
						};

						controller.enqueue(encoder.encode(`data: ${JSON.stringify(modifiedFinish)}\n\n`));
						continue;
					}

					// Pass through event unchanged
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				}

				controller.close();
			} catch (error) {
				controller.error(error);
			} finally {
				reader.releaseLock();
			}
		},
	});
}
