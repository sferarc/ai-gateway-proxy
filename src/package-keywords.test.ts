import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
	keywords: string[];
};
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

// Server frameworks are the Quick Start subsections other than the client and route protection.
const quickStart = readme.split(/^## Quick Start$/m)[1]?.split(/^## /m)[0] ?? "";
const frameworks = [...quickStart.matchAll(/^### (.+)$/gm)]
	.map(([, heading]) => heading)
	.filter((heading) => heading !== "Client" && heading !== "Protecting the route")
	.map((heading) =>
		heading
			.split(" ")[0]
			.toLowerCase()
			.replace(/[^a-z]/g, ""),
	);

describe("package.json keywords", () => {
	it("finds the frameworks of the Quick Start", () => {
		expect(frameworks).toEqual(["nextjs", "hono", "express"]);
	});

	it.each(frameworks)("lists %s", (framework) => {
		expect(pkg.keywords).toContain(framework);
	});

	it("has no duplicates", () => {
		expect(new Set(pkg.keywords).size).toBe(pkg.keywords.length);
	});
});
