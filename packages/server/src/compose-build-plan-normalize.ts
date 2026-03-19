import {
  readObject,
  readServices,
  readTopLevelSecrets,
  rewriteLocalReference
} from "./compose-build-plan-shared";

function isBindMountSource(value: string): boolean {
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value)
  );
}

function rewriteServiceVolumeReferences(input: {
  service: Record<string, unknown>;
  workDir: string;
  composeFile: string;
}): void {
  const volumes = input.service.volumes;
  if (!Array.isArray(volumes)) {
    return;
  }

  input.service.volumes = volumes.map<unknown>((entry) => {
    if (typeof entry === "string") {
      const segments = entry.split(":");
      const source = segments.length >= 2 ? (segments[0]?.trim() ?? "") : "";
      if (!source || !isBindMountSource(source)) {
        return entry;
      }

      const rewrittenSource = rewriteLocalReference({
        workDir: input.workDir,
        composeFile: input.composeFile,
        value: source,
        label: "Compose bind mount source"
      });
      segments[0] = rewrittenSource;
      return segments.join(":");
    }

    const record = readObject(entry);
    if (!record) {
      return entry;
    }

    const source = typeof record?.source === "string" ? record.source : null;
    const type = typeof record?.type === "string" ? record.type : null;
    if (!source || type === "volume" || !isBindMountSource(source)) {
      return entry;
    }

    record.source = rewriteLocalReference({
      workDir: input.workDir,
      composeFile: input.composeFile,
      value: source,
      label: "Compose bind mount source"
    });
    return record;
  });
}

function rewriteBuildAdditionalContexts(input: {
  build: Record<string, unknown>;
  workDir: string;
  composeFile: string;
  warnings: string[];
}): void {
  const additionalContexts = input.build.additional_contexts;
  if (Array.isArray(additionalContexts)) {
    const rewrittenEntries: unknown[] = [];
    for (const entry of additionalContexts) {
      if (typeof entry !== "string") {
        input.warnings.push(
          "Skipped unsupported build.additional_contexts array entry while normalizing compose build metadata."
        );
        rewrittenEntries.push(entry);
        continue;
      }

      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        input.warnings.push(
          `Skipped unsupported build.additional_contexts entry "${entry}" because it was not in name=value form.`
        );
        rewrittenEntries.push(entry);
        continue;
      }

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      const rewritten = rewriteLocalReference({
        workDir: input.workDir,
        composeFile: input.composeFile,
        value,
        label: "Compose build.additional_contexts"
      });
      rewrittenEntries.push(`${name}=${rewritten}`);
    }
    input.build.additional_contexts = rewrittenEntries;
    return;
  }

  const record = readObject(additionalContexts);
  if (!record) {
    return;
  }

  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== "string") {
      input.warnings.push(
        `Skipped unsupported build.additional_contexts entry "${name}" because it was not a string reference.`
      );
      continue;
    }

    record[name] = rewriteLocalReference({
      workDir: input.workDir,
      composeFile: input.composeFile,
      value,
      label: "Compose build.additional_contexts"
    });
  }
}

export function rewriteComposeBuildAndSecretReferences(input: {
  doc: Record<string, unknown>;
  workDir: string;
  composeFile: string;
}): string[] {
  const warnings: string[] = [];
  const services = readServices(input.doc);
  const topLevelSecrets = readTopLevelSecrets(input.doc);

  for (const value of Object.values(services)) {
    const service = readObject(value);
    if (!service) {
      continue;
    }

    const build = service.build;
    if (typeof build === "string") {
      service.build = rewriteLocalReference({
        workDir: input.workDir,
        composeFile: input.composeFile,
        value: build,
        label: "Compose build context"
      });
      rewriteServiceVolumeReferences({
        service,
        workDir: input.workDir,
        composeFile: input.composeFile
      });
      continue;
    }

    const buildRecord = readObject(build);
    if (!buildRecord) {
      rewriteServiceVolumeReferences({
        service,
        workDir: input.workDir,
        composeFile: input.composeFile
      });
      continue;
    }

    if (typeof buildRecord.context === "string") {
      buildRecord.context = rewriteLocalReference({
        workDir: input.workDir,
        composeFile: input.composeFile,
        value: buildRecord.context,
        label: "Compose build context"
      });
    }

    rewriteBuildAdditionalContexts({
      build: buildRecord,
      workDir: input.workDir,
      composeFile: input.composeFile,
      warnings
    });

    rewriteServiceVolumeReferences({
      service,
      workDir: input.workDir,
      composeFile: input.composeFile
    });
  }

  for (const value of Object.values(topLevelSecrets)) {
    const secret = readObject(value);
    if (!secret || typeof secret.file !== "string") {
      continue;
    }

    secret.file = rewriteLocalReference({
      workDir: input.workDir,
      composeFile: input.composeFile,
      value: secret.file,
      label: "Compose secret file"
    });
  }

  const topLevelConfigs = readObject(input.doc.configs) ?? {};
  for (const value of Object.values(topLevelConfigs)) {
    const config = readObject(value);
    if (!config || typeof config.file !== "string") {
      continue;
    }

    config.file = rewriteLocalReference({
      workDir: input.workDir,
      composeFile: input.composeFile,
      value: config.file,
      label: "Compose config file"
    });
  }

  return warnings;
}
