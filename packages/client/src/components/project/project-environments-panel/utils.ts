import type { EnvironmentDraft, EnvironmentRecord } from "./types";

export const INHERIT_SERVER_VALUE = "__inherit_server__";
const ACTIVE_STATUS_VALUE = "active";

function toCommaSeparated(values?: string[]) {
  return (values ?? []).join(", ");
}

export function parseCommaSeparated(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function makeDraft(environment?: EnvironmentRecord): EnvironmentDraft {
  return {
    id: environment?.id,
    name: environment?.name ?? "",
    status: environment?.status ?? ACTIVE_STATUS_VALUE,
    targetServerId: environment?.targetServerId ?? INHERIT_SERVER_VALUE,
    composeFiles: toCommaSeparated(environment?.composeFiles),
    composeProfiles: toCommaSeparated(environment?.composeProfiles)
  };
}
