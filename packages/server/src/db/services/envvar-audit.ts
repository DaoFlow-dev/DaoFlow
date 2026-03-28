export const ENVVAR_AUDIT_CHANGED_FIELDS = [
  "value",
  "isSecret",
  "category",
  "source",
  "secretRef",
  "branchPattern"
] as const;

export function buildEnvironmentVariableSnapshot(input: {
  key: string;
  value: string;
  isSecret: boolean;
  category: "runtime" | "build";
  source: "inline" | "1password";
  secretRef: string | null;
  branchPattern: string | null;
}) {
  return {
    key: input.key,
    value: input.isSecret ? "[secret]" : input.value,
    isSecret: input.isSecret,
    category: input.category,
    source: input.source,
    secretRef: input.secretRef,
    branchPattern: input.branchPattern
  };
}

export function summarizeEnvironmentVariableDiff(input: {
  action: "created" | "updated" | "deleted";
  targetLabel: string;
  key: string;
  changedFields: string[];
}) {
  if (input.action === "created") {
    return `Created ${input.key} in ${input.targetLabel} with redacted audit metadata.`;
  }

  if (input.action === "deleted") {
    return `Deleted ${input.key} from ${input.targetLabel} with a redacted before-state snapshot.`;
  }

  const fieldList =
    input.changedFields.length > 0 ? input.changedFields.join(", ") : "no visible field changes";
  return `Updated ${input.key} in ${input.targetLabel}; changed fields: ${fieldList}.`;
}
