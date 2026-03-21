function sanitizeDockerIdentifier(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  const normalized = (trimmed || fallback.trim().toLowerCase())
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9]+$/g, "");

  if (normalized) {
    return normalized;
  }

  return "service";
}

export function buildDockerContainerName(projectName: string, serviceName: string): string {
  const project = sanitizeDockerIdentifier(projectName, "project");
  const service = sanitizeDockerIdentifier(serviceName, project);
  const combined = `${project}-${service}`.replace(/-+/g, "-").replace(/(^-|-$)/g, "");

  return combined.slice(0, 200) || "service";
}
