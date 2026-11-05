/**
 * The agent skill in skills/ai-gateway-proxy: its frontmatter, its links, and every TypeScript
 * sample type checked against src/index.ts with the repository's compiler options.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillDir = `${root}skills/ai-gateway-proxy/`;
const skill = readFileSync(`${skillDir}SKILL.md`, "utf8");
const referenceFiles = readdirSync(`${skillDir}references`).map((name) => `references/${name}`);
const readme = readFileSync(`${root}README.md`, "utf8");

function typescriptBlocks(markdown: string): string[] {
	return [...markdown.matchAll(/^```typescript\n([\s\S]*?)^```$/gm)].map(([, code]) => code);
}

// Stand-ins for the app's own functions and for frameworks this repository does not install.
const ambient = `
declare const sessionToken: string;
declare function isValidSession(token: string): Promise<boolean>;
declare function hasCredit(authorization: string | null, modelId: string | undefined): Promise<boolean>;
declare function meter(
	authorization: string | null | undefined,
	modelId: string | undefined,
	usage: { inputTokens: number | undefined; outputTokens: number | undefined; complete: boolean },
): Promise<void>;
declare module "hono" {
	export class Hono {
		all(path: string, handler: (c: { req: { raw: Request } }) => Response | Promise<Response>): this;
	}
}
declare module "express" {
	import type { IncomingMessage, ServerResponse } from "node:http";
	interface Application {
		all(path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown): Application;
		listen(port: number): unknown;
	}
	export default function express(): Application;
}
`;

function typeErrors(samples: Map<string, string>): string[] {
	const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
	const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
	const files = new Map(samples);
	files.set(`${skillDir}ambient.d.ts`, ambient);
	const host = ts.createCompilerHost({ ...options, noEmit: true });
	const getSourceFile = host.getSourceFile.bind(host);
	host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
	host.readFile = (name) => files.get(name) ?? ts.sys.readFile(name);
	host.getSourceFile = (name, language, ...rest) => {
		const text = files.get(name);
		return text === undefined
			? getSourceFile(name, language, ...rest)
			: ts.createSourceFile(name, text, language);
	};
	const program = ts.createProgram({
		rootNames: [...files.keys()],
		options: {
			...options,
			noEmit: true,
			moduleDetection: ts.ModuleDetectionKind.Force,
			types: ["node"],
		},
		host,
	});
	return ts
		.getPreEmitDiagnostics(program)
		.map((diagnostic) => ts.formatDiagnostic(diagnostic, host));
}

describe("agent skill", () => {
	const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";

	it("names the skill after its directory", () => {
		expect(frontmatter).toMatch(/^name: ai-gateway-proxy$/m);
	});

	// The Agent Skills format caps the description at 1024 characters.
	it("has a description an agent can match the request against", () => {
		const description = frontmatter.match(/^description: (.+)$/m)?.[1] ?? "";
		expect(description).toContain("so the browser never holds the key");
		expect(description.length).toBeLessThanOrEqual(1024);
	});

	it("stays under 150 lines", () => {
		expect(skill.split("\n").length).toBeLessThan(150);
	});

	it("links only reference files that exist", () => {
		const links = [...skill.matchAll(/\]\(([^)]+)\)/g)].map(([, target]) => target);
		expect(links).toContain("references/express.md");
		for (const link of links.filter((target) => !/^[a-z]+:/.test(target))) {
			expect(existsSync(`${skillDir}${link}`)).toBe(true);
		}
	});

	// The README copy is served over HTTP by readme-adapter.test.ts.
	it("carries the README Express adapter unchanged", () => {
		const reference = readFileSync(`${skillDir}references/express.md`, "utf8");
		const readmeExpress = readme.slice(readme.indexOf("### Express"), readme.indexOf("### Client"));
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeExpress));
	});

	it("is linked from the README", () => {
		expect(readme).toContain("](skills/ai-gateway-proxy/SKILL.md)");
	});

	it("type checks every TypeScript sample against the package exports", () => {
		const samples = new Map<string, string>();
		for (const file of ["SKILL.md", ...referenceFiles]) {
			typescriptBlocks(readFileSync(`${skillDir}${file}`, "utf8")).forEach((code, index) => {
				samples.set(`${skillDir}${file.replace(/[/.]/g, "-")}-${index}.ts`, code);
			});
		}
		expect(samples.size).toBeGreaterThanOrEqual(6);
		expect(typeErrors(samples)).toEqual([]);
	}, 60_000);
});
