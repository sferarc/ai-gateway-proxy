# React Router route

In React Router framework mode, a route module that exports `loader` and `action` and no component answers requests directly. A splat route passes the rest of the path as one string in `params["*"]`, such as `language-model` or `batch/status`, and passes `params` as a plain object, so wrap it in `Promise.resolve` for `segmentsParam: "*"` to read the path.

At `app/routes/ai-proxy.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";
import type { Route } from "./+types/ai-proxy";

const proxy = createGatewayProxy({ segmentsParam: "*" });

export const loader = ({ request, params }: Route.LoaderArgs) =>
  proxy(request, { params: Promise.resolve(params) });

export const action = ({ request, params }: Route.ActionArgs) =>
  proxy(request, { params: Promise.resolve(params) });
```

Register it as a splat route in `app/routes.ts`:

```typescript
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // ...your other routes
  route("api/ai/*", "routes/ai-proxy.ts"),
] satisfies RouteConfig;
```

`loader` answers the `GET` reads such as `getAvailableModels`, and `action` the `POST` model calls.
