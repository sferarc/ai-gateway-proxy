---
"ai-gateway-proxy": patch
---

Ship CommonJS type declarations (`dist/index.d.cts`) for the `require` export. The package had one `index.d.ts` for both conditions, which TypeScript reads as ESM in a `type: module` package, so a CommonJS project resolving with `node16` or `nodenext` was given ESM types for the CommonJS build.
