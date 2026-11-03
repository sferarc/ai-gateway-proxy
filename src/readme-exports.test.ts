import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function exportedNames(source: string): string[] {
	const names: string[] = [];
	for (const [, list] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
		for (const entry of list.split(",")) {
			const name = entry
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.at(-1);
			if (name) {
				names.push(name);
			}
		}
	}
	return names;
}

describe("README exports", () => {
	it("finds the exports of src/index.ts", () => {
		expect(exportedNames(index)).toContain("createGatewayProxy");
		expect(exportedNames(index)).toContain("GatewayApiKey");
	});

	it.each(exportedNames(index))("names %s in README.md", (name) => {
		expect(readme).toMatch(new RegExp(`\`${name}[\`(]`));
	});
});
