export type VolumeSourceKind = "docker-volume" | "bind-mount";

export function resolveVolumeSourceKind(metadata: unknown): VolumeSourceKind {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "docker-volume";
  }
  const driver = (metadata as Record<string, unknown>).driver;
  return typeof driver === "string" && driver.trim().toLowerCase() === "bind"
    ? "bind-mount"
    : "docker-volume";
}
