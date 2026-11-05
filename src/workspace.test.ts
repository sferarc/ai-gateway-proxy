import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function workspacePackages(): string[] {
	const lines = readFileSync(`${root}pnpm-workspace.yaml`, "utf8").split("\n");
	const start = lines.indexOf("packages:");
	const packages: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\s*#/.test(line)) continue;
		const entry = /^\s+-\s+(.+?)\s*$/.exec(line);
		if (!entry) break;
		packages.push(entry[1].replace(/^(["'])(.*)\1$/, "$2"));
	}
	return packages;
}

// changesets reads the packages list through @manypkg/tools, which leaves out the root unless it is listed.
describe("pnpm-workspace.yaml", () => {
	it("lists the root package, so the release workflow can version ai-gateway-proxy", () => {
		expect(workspacePackages()).toContain(".");
	});

	it("still lists the examples", () => {
		expect(workspacePackages()).toContain("examples/*");
	});
});
