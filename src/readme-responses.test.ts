import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const proxy = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const LITERAL = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

function literals(code: string): string[] {
	return [...code.matchAll(LITERAL)].map(([, quoted, template]) =>
		quoted !== undefined ? quoted : (template ?? "").replace(/\$\{\s*(\w+)\s*\}/g, "<$1>"),
	);
}

function callArguments(code: string, start: number): string[] {
	const args: string[] = [];
	let depth = 1;
	let quote: string | undefined;
	let argStart = start;
	for (let i = start; depth > 0; i++) {
		const char = code[i];
		if (char === undefined) {
			throw new Error(`Unclosed call at offset ${start}`);
		}
		if (quote) {
			if (char === "\\") {
				i++;
			} else if (char === quote) {
				quote = undefined;
			}
		} else if (char === '"' || char === "'" || char === "`") {
			quote = char;
		} else if (char === "(") {
			depth++;
		} else if (char === ")" && --depth === 0) {
			args.push(code.slice(argStart, i).trim());
		} else if (char === "," && depth === 1) {
			args.push(code.slice(argStart, i).trim());
			argStart = i + 1;
		}
	}
	return args;
}

// A message held in a variable is read from that variable's last declaration before the call.
function declaredLiterals(code: string, name: string, before: number): string[] {
	const declarations = [
		...code.slice(0, before).matchAll(new RegExp(`const ${name}\\s*=\\s*`, "g")),
	];
	const last = declarations.at(-1);
	if (last?.index === undefined) {
		return [];
	}
	const value = code
		.slice(last.index + last[0].length)
		.match(/^(?:"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/);
	return value ? literals(value[0]) : [];
}

// Each pair is a code and the message sent with it; a ternary pairs its branches in order.
function proxyErrors(code: string): [string, string][] {
	const errors = new Map<string, [string, string]>();
	for (const call of code.matchAll(/(?<!function )proxyErrorResponse\(/g)) {
		const start = (call.index ?? 0) + call[0].length;
		const [, , codeArgument = "", message = ""] = callArguments(code, start);
		const codes = literals(codeArgument);
		const messages = /^\w+$/.test(message)
			? declaredLiterals(code, message, call.index ?? 0)
			: literals(message);
		if (messages.length === 0 || codes.length !== messages.length) {
			throw new Error(
				`No literal code and message for proxyErrorResponse(${codeArgument}, ${message})`,
			);
		}
		messages.forEach((literal, i) => {
			errors.set(literal, [codes[i] ?? "", literal]);
		});
	}
	return [...errors.values()];
}

function proxyErrorMessages(code: string): string[] {
	return proxyErrors(code).map(([, message]) => message);
}

function responsesTable(markdown: string): string {
	const start = markdown.indexOf("## Responses the proxy generates");
	const end = markdown.indexOf("\n## ", start + 1);
	return start === -1 ? "" : markdown.slice(start, end === -1 ? undefined : end);
}

describe("README responses table", () => {
	it("finds the messages passed to proxyErrorResponse in src/proxy.ts", () => {
		const messages = proxyErrorMessages(proxy);
		expect(messages).toContain("Invalid path");
		expect(messages).toContain(
			"AI Gateway authentication not configured: the apiKey option gave no key",
		);
		expect(messages).toContain("afterResponse hook returned an invalid response: <problem>");
		expect(messages).toContain(
			"beforeRequest hook returned an invalid request: the result must be an object",
		);
	});

	it.each(proxyErrorMessages(proxy))("lists %s in README.md", (message) => {
		expect(responsesTable(readme)).toContain(`| \`${message}\` |`);
	});

	it.each(proxyErrors(proxy))("lists code %s with its message in README.md", (code, message) => {
		expect(responsesTable(readme)).toContain(`| \`${code}\` | \`${message}\` |`);
	});

	it("documents every ProxyErrorCode in the table, once, and no other code", () => {
		const union = types.match(/export type ProxyErrorCode =([^;]*);/)?.[1] ?? "";
		const declared = literals(union).sort();
		const documented = [...responsesTable(readme).matchAll(/^\| [^|]+ \| [^|]+ \| `(\w+)` \|/gm)]
			.map(([, code]) => code ?? "")
			.sort();
		expect(declared).toContain("credential_rejected");
		expect(documented).toEqual(declared);
	});
});
