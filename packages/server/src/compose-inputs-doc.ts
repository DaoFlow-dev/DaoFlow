import type { ComposeImageOverrideRequest } from "./compose-inputs-shared";

interface ComposeEnvFileReference {
  serviceName: string;
  path: string;
  required: boolean;
  format?: string;
}

export function collectServiceEnvFileReferences(
  doc: Record<string, unknown>
): Map<string, ComposeEnvFileReference[]> {
  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : null;
  const results = new Map<string, ComposeEnvFileReference[]>();

  if (!services) {
    return results;
  }

  for (const [serviceName, value] of Object.entries(services)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const service = value as Record<string, unknown>;
    const envFile = service.env_file;
    const references: ComposeEnvFileReference[] = [];

    const pushReference = (path: string, required: boolean, format?: string) => {
      references.push({
        serviceName,
        path,
        required,
        ...(format ? { format } : {})
      });
    };

    if (typeof envFile === "string") {
      pushReference(envFile, true);
    } else if (Array.isArray(envFile)) {
      for (const entry of envFile) {
        if (typeof entry === "string") {
          pushReference(entry, true);
          continue;
        }

        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          if (typeof record.path === "string") {
            pushReference(
              record.path,
              record.required !== false,
              typeof record.format === "string" ? record.format : undefined
            );
          }
        }
      }
    }

    if (references.length > 0) {
      results.set(serviceName, references);
    }
  }

  return results;
}

export function applyComposeImageOverride(
  doc: Record<string, unknown>,
  imageOverride?: ComposeImageOverrideRequest
): void {
  const serviceName = imageOverride?.serviceName?.trim();
  const imageReference = imageOverride?.imageReference?.trim();
  if (!serviceName || !imageReference) {
    return;
  }

  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : null;
  if (!services) {
    throw new Error("Compose image override requires a compose document with services.");
  }

  const serviceValue = services[serviceName];
  if (!serviceValue || typeof serviceValue !== "object" || Array.isArray(serviceValue)) {
    throw new Error(
      `Compose image override targets unknown service "${serviceName}" in the rendered compose file.`
    );
  }

  const service = serviceValue as Record<string, unknown>;
  service.image = imageReference;
}
