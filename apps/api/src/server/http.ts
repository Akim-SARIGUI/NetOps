import { z } from "zod";
import { getConfig } from "./config";
import { AppError, ValidationError } from "./errors";
import { logger } from "./logger";

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const started = Date.now();
    const url = new URL(request.url);

    try {
      const response = await handler(request, context);
      response.headers.set("x-request-id", requestId);
      applyCors(response);
      logger.info(
        {
          requestId,
          method: request.method,
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - started,
        },
        "request",
      );
      return response;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      applyCors(response);
      const status = response.status;
      const payload = {
        requestId,
        method: request.method,
        path: url.pathname,
        status,
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
      };
      if (status >= 500) logger.error({ ...payload, err: error }, "request failed");
      else logger.warn(payload, "request rejected");
      return response;
    }
  };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError([{ path: "body", message: "JSON invalide" }]);
  }
  return parseSchema(schema, payload);
}

export function readSearchParams<T>(request: Request, schema: z.ZodType<T>): T {
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return parseSchema(schema, payload);
}

export async function routeParams(
  context: RouteContext,
): Promise<Record<string, string>> {
  return context.params;
}

function parseSchema<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function applyCors(response: Response) {
  const origin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Vary", "Origin");
}

function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
          requestId,
        },
      },
      error.status,
    );
  }

  logger.error({ err: error, requestId }, "unhandled error");
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Erreur interne",
        details: null,
        requestId,
      },
    },
    500,
  );
}

export function corsPreflight(): Response {
  const response = new Response(null, { status: 204 });
  applyCors(response);
  return response;
}

export function assertConfigLoaded() {
  getConfig();
}
