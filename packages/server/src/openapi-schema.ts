/**
 * Generate a machine-readable API reference from the tRPC router.
 *
 * Run: bun packages/server/src/openapi-schema.ts > docs/api-reference.json
 */
import { appRouter } from "./router";

interface ProcedureInfo {
  path: string;
  type: "query" | "mutation" | "subscription";
  httpMethod: "GET" | "POST";
  inputSchema: unknown;
}

function extractProcedures(router: typeof appRouter): ProcedureInfo[] {
  const procedures: ProcedureInfo[] = [];
  const entries = Object.entries(router._def.procedures) as [string, unknown][];

  for (const [path, procedure] of entries) {
    const proc = procedure as Record<string, unknown>;
    const meta = proc._def as Record<string, unknown> | undefined;
    if (!meta) continue;

    const type: "query" | "mutation" | "subscription" =
      meta.type === "query"
        ? "query"
        : meta.type === "mutation"
          ? "mutation"
          : meta.query
            ? "query"
            : meta.mutation
              ? "mutation"
              : "subscription";

    let inputSchema: unknown = null;
    const inputs = meta.inputs as unknown[] | undefined;
    if (Array.isArray(inputs) && inputs.length > 0) {
      const zodSchema = inputs[0] as Record<string, unknown>;
      if (zodSchema && typeof zodSchema === "object" && "_def" in zodSchema) {
        const typeName = (zodSchema._def as Record<string, unknown>).typeName;
        if (typeName === "ZodObject") {
          const shape = (zodSchema._def as Record<string, unknown>).shape;
          if (typeof shape === "function") {
            const shapeObj = (shape as () => Record<string, unknown>)();
            inputSchema = Object.fromEntries(
              Object.entries(shapeObj).map(([key, val]) => {
                const def = (val as Record<string, unknown>)._def as Record<string, unknown>;
                return [
                  key,
                  {
                    type: (typeof def?.typeName === "string" ? def.typeName : "unknown")
                      .replace("Zod", "")
                      .toLowerCase(),
                    optional: def?.typeName === "ZodOptional" || "defaultValue" in (def ?? {}),
                    description: (def?.description as string) ?? null
                  }
                ];
              })
            );
          }
        }
      }
    }

    procedures.push({
      path,
      type,
      httpMethod: type === "query" ? "GET" : "POST",
      inputSchema
    });
  }

  return procedures;
}

function generateOpenApiSpec(procedures: ProcedureInfo[]) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const proc of procedures) {
    const path = `/trpc/${proc.path}`;
    const method = proc.httpMethod.toLowerCase();

    const parameters: unknown[] = [];
    if (proc.inputSchema && proc.httpMethod === "GET") {
      parameters.push({
        name: "input",
        in: "query",
        required: true,
        schema: { type: "string" },
        description: "JSON-encoded input: " + JSON.stringify(proc.inputSchema)
      });
    }

    const requestBody =
      proc.httpMethod === "POST" && proc.inputSchema
        ? {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: proc.inputSchema
                }
              }
            }
          }
        : undefined;

    paths[path] = {
      [method]: {
        operationId: proc.path,
        tags: [proc.type],
        parameters: parameters.length > 0 ? parameters : undefined,
        requestBody,
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    result: {
                      type: "object",
                      properties: {
                        data: { description: "Response payload" }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden — missing required scope" }
        }
      }
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "DaoFlow API",
      version: "0.9.0",
      description: "DaoFlow control-plane API. All procedures are accessed via tRPC over HTTP."
    },
    servers: [{ url: "http://localhost:3000", description: "Local development" }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token"
        },
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description: "API token (dfl_ prefix)"
        }
      }
    },
    security: [{ sessionCookie: [] }, { bearerToken: [] }]
  };
}

const procedures = extractProcedures(appRouter);
const spec = generateOpenApiSpec(procedures);
console.log(JSON.stringify(spec, null, 2));
