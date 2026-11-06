/**
 * The agent skill in skills/ai-gateway-proxy: its frontmatter, its links, and every TypeScript
 * sample type checked against src/index.ts with the repository's compiler options.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayProxy } from "./index";

vi.mock("@vercel/oidc", () => ({
	getVercelOidcToken: vi.fn(),
}));

const root = fileURLToPath(new URL("../", import.meta.url));
const skillDir = `${root}skills/ai-gateway-proxy/`;
const skill = readFileSync(`${skillDir}SKILL.md`, "utf8");
const referenceFiles = readdirSync(`${skillDir}references`).map((name) => `references/${name}`);
const readme = readFileSync(`${root}README.md`, "utf8");

function typescriptBlocks(markdown: string): string[] {
	return [...markdown.matchAll(/^```typescript\n([\s\S]*?)^```$/gm)].map(([, code]) => code);
}

// Stand-ins for the app's own functions and for frameworks this repository does not install; Nuxt's auto-imports come from the installed h3.
const ambient = `
declare const sessionToken: string;
declare function isValidSession(token: string): Promise<boolean>;
declare function hasCredit(authorization: string | null, modelId: string | undefined): Promise<boolean>;
declare function meter(
	authorization: string | null | undefined,
	modelId: string | undefined,
	usage: { inputTokens: number | undefined; outputTokens: number | undefined; complete: boolean },
): Promise<void>;
declare const defineEventHandler: typeof import("h3").defineEventHandler;
declare const toWebRequest: typeof import("h3").toWebRequest;
declare const getRouterParams: typeof import("h3").getRouterParams;
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
declare module "@react-router/dev/routes" {
	export interface RouteConfigEntry {
		path?: string;
		file: string;
		children?: RouteConfigEntry[];
	}
	export type RouteConfig = RouteConfigEntry[] | Promise<RouteConfigEntry[]>;
	export function route(path: string, file: string, children?: RouteConfigEntry[]): RouteConfigEntry;
}
declare module "@tanstack/react-router" {
	type Handler = (context: {
		request: Request;
		params: { _splat?: string };
	}) => Response | Promise<Response>;
	export function createFileRoute(path: string): (options: {
		server: { handlers: Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>> };
	}) => unknown;
}
// Each runtime calls the handler with a second argument that is not the proxy's { params } context.
declare const Bun: {
	serve(options: {
		routes: Record<string, (request: Request, server: unknown) => Response | Promise<Response>>;
		fetch: (request: Request, server: unknown) => Response | Promise<Response>;
	}): unknown;
};
declare const Deno: {
	serve(handler: (request: Request, info: unknown) => Response | Promise<Response>): unknown;
};
declare module "npm:ai-gateway-proxy" {
	export * from "ai-gateway-proxy";
}
declare module "astro" {
	export type APIRoute = (context: {
		request: Request;
		params: Record<string, string | undefined>;
	}) => Response | Promise<Response>;
}
`;

// SvelteKit generates ./$types per route; a relative module cannot be declared ambiently.
const svelteKitTypes = `
export type RequestHandler = (event: {
	request: Request;
	params: { path: string };
}) => Response | Promise<Response>;
`;

// React Router generates ./+types/<route> per route module, likewise a virtual file here.
const reactRouterTypes = `
export declare namespace Route {
	type LoaderArgs = { request: Request; params: { "*": string } };
	type ActionArgs = LoaderArgs;
}
`;

// The Fastify and Koa routes import the Express adapter's handle from its own module.
const gatewayHandleTypes = `
import type { IncomingMessage, ServerResponse } from "node:http";
export declare function handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
`;

function typeErrors(samples: Map<string, string>): string[] {
	const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
	const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
	const files = new Map(samples);
	files.set(`${skillDir}ambient.d.ts`, ambient);
	files.set(`${skillDir}$types.d.ts`, svelteKitTypes);
	files.set(`${skillDir}+types/ai-proxy.d.ts`, reactRouterTypes);
	files.set(`${skillDir}gateway-handle.d.ts`, gatewayHandleTypes);
	const host = ts.createCompilerHost({ ...options, noEmit: true });
	const getSourceFile = host.getSourceFile.bind(host);
	host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
	host.directoryExists = (name) =>
		[...files.keys()].some((file) => file.startsWith(`${name}/`)) ||
		(ts.sys.directoryExists?.(name) ?? false);
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
		const readmeExpress = readme.slice(
			readme.indexOf("### Express"),
			readme.indexOf("### Fastify"),
		);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeExpress));
	});

	// The README copy runs through browser CORS checks in readme-cors.test.ts.
	it("carries the README cross-origin wrapper unchanged", () => {
		expect(skill).toContain("](references/cors.md)");
		const reference = readFileSync(`${skillDir}references/cors.md`, "utf8");
		const readmeCors = readme.slice(
			readme.indexOf("### Calling from another origin"),
			readme.indexOf("## Authentication"),
		);
		expect(typescriptBlocks(readmeCors)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeCors));
	});

	// The README copies run between a real gateway client and a fake gateway in readme-rest-routes.test.ts.
	it("carries the README SvelteKit and Astro routes unchanged", () => {
		expect(skill).toContain("](references/sveltekit-astro.md)");
		const reference = readFileSync(`${skillDir}references/sveltekit-astro.md`, "utf8");
		const readmeRoutes = readme.slice(
			readme.indexOf("### SvelteKit"),
			readme.indexOf("### React Router"),
		);
		expect(typescriptBlocks(readmeRoutes)).toHaveLength(2);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoutes));
	});

	// The README copy runs between a real gateway client and a fake gateway in readme-rest-routes.test.ts.
	it("carries the README React Router route unchanged", () => {
		expect(skill).toContain("](references/react-router.md)");
		const reference = readFileSync(`${skillDir}references/react-router.md`, "utf8");
		const readmeRoute = readme.slice(
			readme.indexOf("### React Router"),
			readme.indexOf("### TanStack Start"),
		);
		expect(typescriptBlocks(readmeRoute)).toHaveLength(2);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoute));
	});

	// The README copy runs between a real gateway client and a fake gateway in readme-rest-routes.test.ts.
	it("carries the README TanStack Start route unchanged", () => {
		expect(skill).toContain("](references/tanstack-start.md)");
		const reference = readFileSync(`${skillDir}references/tanstack-start.md`, "utf8");
		const readmeRoute = readme.slice(
			readme.indexOf("### TanStack Start"),
			readme.indexOf("### Nuxt"),
		);
		expect(typescriptBlocks(readmeRoute)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoute));
	});

	// The README copy runs in a real h3 app between a real gateway client and a fake gateway in readme-nuxt.test.ts.
	it("carries the README Nuxt route unchanged", () => {
		expect(skill).toContain("](references/nuxt.md)");
		const reference = readFileSync(`${skillDir}references/nuxt.md`, "utf8");
		const readmeRoute = readme.slice(readme.indexOf("### Nuxt"), readme.indexOf("### Express"));
		expect(typescriptBlocks(readmeRoute)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoute));
	});

	// The README copy runs in a real Fastify app between a real gateway client and a fake gateway in readme-fastify.test.ts.
	it("carries the README Fastify route unchanged", () => {
		expect(skill).toContain("](references/fastify.md)");
		const reference = readFileSync(`${skillDir}references/fastify.md`, "utf8");
		const readmeRoute = readme.slice(readme.indexOf("### Fastify"), readme.indexOf("### Koa"));
		expect(typescriptBlocks(readmeRoute)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoute));
	});

	// The README copy runs in a real Koa app between a real gateway client and a fake gateway in readme-koa.test.ts.
	it("carries the README Koa route unchanged", () => {
		expect(skill).toContain("](references/koa.md)");
		const reference = readFileSync(`${skillDir}references/koa.md`, "utf8");
		const readmeRoute = readme.slice(readme.indexOf("### Koa"), readme.indexOf("### Client"));
		expect(typescriptBlocks(readmeRoute)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeRoute));
	});

	// The README copies run with Bun.serve and Deno.serve stubbed between a real gateway client and a fake gateway in readme-bun-deno.test.ts.
	it("carries the README Bun and Deno servers unchanged", () => {
		expect(skill).toContain("](references/bun-deno.md)");
		const reference = readFileSync(`${skillDir}references/bun-deno.md`, "utf8");
		const readmeServers = readme.slice(
			readme.indexOf("### Bun"),
			readme.indexOf("### Cloudflare Workers"),
		);
		expect(typescriptBlocks(readmeServers)).toHaveLength(2);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeServers));
		expect(reference).toContain("--allow-env");
	});

	// The README copy runs with an env and an execution context between a real gateway client and a fake gateway in readme-cloudflare-workers.test.ts.
	it("carries the README Cloudflare Worker unchanged", () => {
		expect(skill).toContain("](references/cloudflare-workers.md)");
		const reference = readFileSync(`${skillDir}references/cloudflare-workers.md`, "utf8");
		const readmeWorker = readme.slice(
			readme.indexOf("### Cloudflare Workers"),
			readme.indexOf("### SvelteKit"),
		);
		expect(typescriptBlocks(readmeWorker)).toHaveLength(1);
		expect(typescriptBlocks(reference)).toEqual(typescriptBlocks(readmeWorker));
		expect(reference).toContain("wrangler secret put AI_GATEWAY_API_KEY");
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
		expect(samples.size).toBeGreaterThanOrEqual(8);
		expect(typeErrors(samples)).toEqual([]);
	}, 60_000);
});

// Agents copy the sample, so it runs here as written rather than as a hand kept copy.
function capSampleProxy(hasCredit: () => Promise<boolean>, meter: () => Promise<void>) {
	const sample = typescriptBlocks(skill).find((code) => code.includes("beforeRequest"));
	if (!sample) throw new Error("SKILL.md has no beforeRequest sample");
	const script = ts.transpileModule(sample.replace(/^import .*\n/m, ""), {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const build = new Function(
		"createGatewayProxy",
		"hasCredit",
		"meter",
		`${script}\nreturn proxy;`,
	);
	return build(createGatewayProxy, hasCredit, meter) as ReturnType<typeof createGatewayProxy>;
}

describe("agent skill: cap, meter and refuse sample", () => {
	const fetchMock = vi.fn();
	const context = { params: Promise.resolve({ segments: ["language-model"] }) };

	function call(body: string) {
		const proxy = capSampleProxy(
			async () => true,
			async () => {},
		);
		return proxy(
			new Request("http://localhost/api/ai/language-model", {
				method: "POST",
				body,
				headers: {
					"content-type": "application/json",
					"ai-language-model-id": "openai/gpt-5",
					"ai-language-model-streaming": "false",
				},
			}),
			context,
		);
	}

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	// #200 review: Math.min of a string is NaN, which JSON sends upstream as null, lifting the cap.
	it.each([
		["a string", '"lots"'],
		["an object", "{}"],
		["null", "null"],
		["a negative number", "-1"],
		["zero", "0"],
		["a fraction", "1.5"],
		["a number past the safe integers", String(2 ** 53)],
		["Infinity", "1e999"],
	])(
		"answers 400 to a maxOutputTokens that is %s without calling the gateway",
		async (_, value) => {
			const response = await call(`{"prompt":[],"maxOutputTokens":${value}}`);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					message: "maxOutputTokens must be a positive integer",
					type: "invalid_request_error",
				},
			});
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it.each([
		["absent", "", 1024],
		["4096", ',"maxOutputTokens":4096', 1024],
		["100", ',"maxOutputTokens":100', 100],
	])("sends a maxOutputTokens that is %s upstream as %s", async (_, field, sent) => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				content: [{ type: "text", text: "Hi" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			}),
		);

		const response = await call(`{"prompt":[]${field}}`);

		expect(response.status).toBe(200);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string).maxOutputTokens).toBe(sent);
	});
});
