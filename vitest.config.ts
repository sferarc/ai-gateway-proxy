import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ quiet: true });

export default defineConfig({
	// examples/nextjs imports the package by name; tests run it against src, before any build.
	resolve: {
		alias: { "ai-gateway-proxy": fileURLToPath(new URL("./src/index.ts", import.meta.url)) },
	},
	test: {
		environment: "node",
	},
});
