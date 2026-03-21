export const UNLINKED_SERVICE = "__unlinked_service__";
const DEFAULT_STATUS = "active";

export interface VolumeDraft {
  id?: string;
  name: string;
  serverId: string;
  mountPath: string;
  serviceId: string;
  driver: string;
  sizeBytes: string;
  status: "active" | "inactive" | "paused";
}

export function makeDraft(
  volume?: {
    id: string;
    volumeName: string;
    serverId: string;
    mountPath: string;
    serviceId: string | null;
    driver: string;
    sizeBytes: number;
    status: string;
  } | null
): VolumeDraft {
  return {
    id: volume?.id,
    name: volume?.volumeName ?? "",
    serverId: volume?.serverId ?? "",
    mountPath: volume?.mountPath ?? "",
    serviceId: volume?.serviceId ?? UNLINKED_SERVICE,
    driver: volume?.driver ?? "local",
    sizeBytes: volume?.sizeBytes ? String(volume.sizeBytes) : "",
    status: (volume?.status as VolumeDraft["status"]) ?? DEFAULT_STATUS
  };
}
