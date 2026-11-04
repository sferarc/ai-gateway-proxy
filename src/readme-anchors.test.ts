import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

// GitHub's heading slugs: lowercase, punctuation dropped, spaces to hyphens, repeats suffixed -1, -2.
function headingSlugs(markdown: string): Set<string> {
	const slugs = new Set<string>();
	const seen = new Map<string, number>();
	const prose = markdown.replace(/^```[\s\S]*?^```/gm, "");
	for (const [, heading] of prose.matchAll(/^#{1,6}\s+(.+)$/gm)) {
		const base = heading
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s_-]/gu, "")
			.replace(/\s/g, "-");
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		slugs.add(count === 0 ? base : `${base}-${count}`);
	}
	return slugs;
}

const anchors = [...new Set([...readme.matchAll(/\]\(#([^)]+)\)/g)].map(([, anchor]) => anchor))];

describe("README anchors", () => {
	it("slugs headings as GitHub does", () => {
		const slugs = headingSlugs(readme);
		expect(slugs).toContain("example-cap-meter-and-mask");
		expect(slugs).toContain("afterresponse");
		expect(slugs).not.toContain("installation-1");
	});

	it("finds the links of the opening", () => {
		expect(anchors).toContain("protecting-the-route");
	});

	it.each(anchors)("links #%s to a heading", (anchor) => {
		expect(headingSlugs(readme)).toContain(anchor);
	});

	// The sferadev.com page describes an older API (#177). Re-add a docs link only once one matches the code.
	it("links no stale documentation site", () => {
		expect(readme).not.toContain("sferadev.com/docs");
	});
});
