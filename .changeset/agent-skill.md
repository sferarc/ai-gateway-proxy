---
"ai-gateway-proxy": patch
---

Link the agent skill from the README: `npx skills add sferarc/ai-gateway-proxy` installs `skills/ai-gateway-proxy`, which tells a coding agent when the proxy is needed and how to add the route, point the client at it, protect it and meter calls.

The README example "cap, meter and mask" now answers 400 to a `maxOutputTokens` that is not a positive integer before capping it: `Math.min` of a string is `NaN`, which reached the gateway as `null` and lifted the cap.
