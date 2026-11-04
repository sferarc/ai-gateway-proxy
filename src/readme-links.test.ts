import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");
const prose = readme.replace(/^```[\s\S]*?^```/gm, "");
const targets = [...prose.matchAll(/\]\(([^)]+)\)/g)].map(([, target]) => target);
const fileLinks = [...new Set(targets.filter((target) => !/^(#|[a-z]+:)/.test(target)))];

function section(heading: string): string {
	const start = prose.indexOf(`\n## ${heading}\n`);
	const end = prose.indexOf("\n## ", start + 1);
	return prose.slice(start, end === -1 ? undefined : end);
}

describe("README links", () => {
	it("finds the changelog link", () => {
		expect(fileLinks).toContain("CHANGELOG.md");
	});

	it.each(fileLinks)("links %s to a file in the repository", (target) => {
		expect(existsSync(new URL(target, root))).toBe(true);
	});

	// An outside docs page drifted from the code once (#177), so the section points only at this repository.
	it("sends the Documentation section to no outside page", () => {
		const documentation = section("Documentation");
		expect(documentation).toContain("CHANGELOG.md");
		expect(documentation).not.toMatch(/\]\([a-z]+:/);
	});

	it("sends readers who do not need the proxy to the AI SDK gateway provider", () => {
		const whenNotNeeded = section("When you do not need it");
		expect(whenNotNeeded).toContain("](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)");
		expect(whenNotNeeded).toContain("](#protecting-the-route)");
	});
});
