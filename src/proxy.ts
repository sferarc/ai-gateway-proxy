import { getVercelOidcToken } from "@vercel/oidc";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";

type CreateGatewayProxyOptions = {
  baseUrl?: string;
  headers?: Record<string, string>;
  transformRequest?: (
    options: LanguageModelV2CallOptions | null,
  ) => LanguageModelV2CallOptions | Promise<LanguageModelV2CallOptions> | null;
};

type CreateGatewayProxyFn = (
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) => Promise<Response>;

type CreateGatewayProxyResult = CreateGatewayProxyFn & {
  GET: CreateGatewayProxyFn;
  POST: CreateGatewayProxyFn;
  PUT: CreateGatewayProxyFn;
  DELETE: CreateGatewayProxyFn;
  PATCH: CreateGatewayProxyFn;
};

export const createGatewayProxy = ({
  baseUrl = "https://ai-gateway.vercel.sh/v1/ai",
  headers,
  transformRequest = (options) => options,
}: CreateGatewayProxyOptions = {}): CreateGatewayProxyResult => {
  const handler = async (
    request: Request,
    { params }: { params: Promise<{ segments?: string[] }> },
  ) => {
    const auth = await getGatewayAuthToken();
    if (!auth) {
      return new Response("AI Gateway authentication not configured", {
        status: 500,
      });
    }

    const { segments } = await params;
    const path = segments?.join("/") ?? "";
    const searchParams = new URLSearchParams(request.url.split("?")[1]);
    const upstream = `${baseUrl}/${path}${searchParams.toString()}`;
    const body = await transformRequest(await request.clone().json());

    try {
      const res = await fetch(upstream, {
        method: request.method,
        body: body ? JSON.stringify(body) : null,
        // Node fetch needs duplex when body is a stream
        ...(body && { duplex: "half" }),
        headers: {
          ...headers,
          authorization: `Bearer ${auth.token}`,
          "ai-gateway-auth-method": auth.authMethod,
          "ai-gateway-protocol-version": "0.0.1",
          "ai-language-model-specification-version":
            request.headers.get("ai-language-model-specification-version") ??
            "2",
          "ai-language-model-id":
            request.headers.get("ai-language-model-id") ?? "",
          "ai-language-model-streaming":
            request.headers.get("ai-language-model-streaming") ?? "false",
        },
      });

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
      });
    } catch (error) {
      console.error("Error proxying request to AI Gateway:", error);
      return new Response("Error proxying request to AI Gateway", {
        status: 500,
      });
    }
  };

  handler.GET = handler;
  handler.POST = handler;
  handler.PUT = handler;
  handler.DELETE = handler;
  handler.PATCH = handler;

  return handler;
};

async function getGatewayAuthToken(): Promise<{
  token: string;
  authMethod: "api-key" | "oidc";
} | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) {
    return { token: apiKey, authMethod: "api-key" };
  }

  try {
    const oidcToken = await getVercelOidcToken();
    return { token: oidcToken, authMethod: "oidc" };
  } catch {
    return null;
  }
}
