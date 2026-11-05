"use client";

import { createGateway } from "@ai-sdk/gateway";
import { streamText } from "ai";
import { type FormEvent, useState } from "react";
import type { CallerUsage } from "../lib/usage";

type UsageReport = CallerUsage & { caller: string; limit: number };

export default function Page() {
	const [token, setToken] = useState("demo-token-alice");
	const [prompt, setPrompt] = useState("Write a haiku about proxies.");
	const [text, setText] = useState("");
	const [error, setError] = useState<string>();
	const [usage, setUsage] = useState<UsageReport>();
	const [running, setRunning] = useState(false);

	async function run(event: FormEvent) {
		event.preventDefault();
		setRunning(true);
		setText("");
		setError(undefined);
		// The token reaches the route as the bearer token; the proxy sends its own key upstream.
		const gateway = createGateway({ baseURL: `${window.location.origin}/api/ai`, apiKey: token });
		try {
			const result = streamText({
				model: gateway("openai/gpt-5"),
				prompt,
				onError: ({ error }) => setError(error instanceof Error ? error.message : String(error)),
			});
			for await (const delta of result.textStream) setText((current) => current + delta);
			const response = await fetch("/api/usage", { headers: { authorization: `Bearer ${token}` } });
			setUsage(response.ok ? await response.json() : undefined);
		} finally {
			setRunning(false);
		}
	}

	return (
		<main>
			<h1>ai-gateway-proxy</h1>
			<form onSubmit={run} style={{ display: "grid", gap: "0.5rem" }}>
				<label>
					Caller token{" "}
					<select value={token} onChange={(event) => setToken(event.target.value)}>
						<option value="demo-token-alice">alice</option>
						<option value="demo-token-bob">bob</option>
						<option value="not-signed-in">not signed in</option>
					</select>
				</label>
				<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
				<button type="submit" disabled={running}>
					{running ? "Streaming" : "Send"}
				</button>
			</form>
			{error && <p role="alert">{error}</p>}
			<p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
			{usage && (
				<p>
					{usage.caller}: {usage.calls} calls, {usage.inputTokens} input and {usage.outputTokens} of{" "}
					{usage.limit} output tokens
				</p>
			)}
		</main>
	);
}
