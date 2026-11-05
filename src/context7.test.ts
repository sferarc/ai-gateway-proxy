import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(readFileSync(`${root}context7.json`, "utf8")) as {
	$schema: string;
	projectTitle: string;
	description: string;
	excludeFolders: string[];
	excludeFiles: string[];
	rules: string[];
};

// Limits from https://context7.com/schema/context7.json; Context7 ignores a file that breaks them.
describe("context7.json", () => {
	it("references the Context7 schema", () => {
		expect(config.$schema).toBe("https://context7.com/schema/context7.json");
	});

	it("keeps the title and description within the schema lengths", () => {
		expect(config.projectTitle.length).toBeLessThanOrEqual(100);
		expect(config.description.length).toBeGreaterThanOrEqual(10);
		expect(config.description.length).toBeLessThanOrEqual(500);
	});

	it.each(config.rules)("keeps the rule within 255 characters: %s", (rule) => {
		expect(rule.length).toBeLessThanOrEqual(255);
	});

	it("excludes the internal notes, changesets and sources", () => {
		expect(config.excludeFolders).toEqual(expect.arrayContaining(["brain", ".changeset", "src"]));
	});

	it.each(config.excludeFolders)("excludes a folder that exists: %s", (folder) => {
		expect(existsSync(`${root}${folder}`)).toBe(true);
	});

	// Any excludeFiles entry turns off Context7's default exclusions, which drop CHANGELOG.md.
	it("names files only and keeps README.md and CHANGELOG.md indexed", () => {
		expect(config.excludeFiles.length).toBeGreaterThan(0);
		for (const file of config.excludeFiles) {
			expect(file).not.toMatch(/[/\\]/);
			expect(existsSync(`${root}${file}`)).toBe(true);
		}
		expect(config.excludeFiles).not.toContain("README.md");
		expect(config.excludeFiles).not.toContain("CHANGELOG.md");
	});

	it("tells agents the proxy is not OpenAI compatible", () => {
		expect(config.rules.some((rule) => rule.includes("not an OpenAI-compatible endpoint"))).toBe(
			true,
		);
	});
});
