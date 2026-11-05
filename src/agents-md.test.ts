import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

describe("agent instructions", () => {
	// Claude Code reads CLAUDE.md and other agents read AGENTS.md; the import keeps one source.
	it("CLAUDE.md only imports AGENTS.md", () => {
		expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
	});

	it("AGENTS.md holds the contribution rules", () => {
		const agents = read("AGENTS.md");
		expect(agents).toContain("pnpm check");
		expect(agents).toContain("pnpm changeset");
		expect(agents).toContain("brain/development/release.md");
	});
});
