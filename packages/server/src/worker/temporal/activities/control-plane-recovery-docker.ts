import { hostname } from "node:os";

import { dockerCapture } from "./control-plane-recovery-docker-runner";

const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

export interface ControlPlanePostgresSource {
  containerName: string;
  databaseName: string;
  databaseUser: string;
  sourcePostgresVersion: string;
  verifierImage: string;
}

export async function inspectControlPlanePostgres(
  signal?: AbortSignal
): Promise<ControlPlanePostgresSource> {
  const containerName = await discoverControlPlanePostgresContainer(signal);
  const [imageDetails, version] = await Promise.all([
    dockerCapture(
      ["inspect", "--format", "{{.Config.Image}}|{{.Image}}", containerName],
      "inspect the control-plane database image",
      signal
    ),
    dockerCapture(
      ["exec", containerName, "pg_dump", "--version"],
      "inspect the control-plane database version",
      signal
    )
  ]);
  const [configuredImage = "", imageId = ""] = imageDetails.trim().split("|");
  const sourcePostgresVersion = parsePostgresVersion(version);
  const verifierImage = await pinnedPgvectorImage(
    configuredImage,
    imageId,
    sourcePostgresVersion,
    signal
  );
  const databaseUser = await containerPostgresIdentifier(
    containerName,
    "POSTGRES_USER",
    "postgres",
    signal
  );
  const databaseName = await containerPostgresIdentifier(
    containerName,
    "POSTGRES_DB",
    databaseUser,
    signal
  );
  return { containerName, databaseName, databaseUser, sourcePostgresVersion, verifierImage };
}

async function discoverControlPlanePostgresContainer(signal?: AbortSignal): Promise<string> {
  const explicit = process.env.DAOFLOW_CONTROL_PLANE_POSTGRES_CONTAINER?.trim();
  if (explicit) {
    assertContainerName(explicit);
    await dockerCapture(
      ["inspect", "--format", "{{.Id}}", explicit],
      "inspect control-plane database",
      signal
    );
    return explicit;
  }
  const project = process.env.COMPOSE_PROJECT_NAME?.trim() ?? (await currentComposeProject(signal));
  if (!project) {
    throw new Error(
      "Set DAOFLOW_CONTROL_PLANE_POSTGRES_CONTAINER when the current Compose project cannot be determined."
    );
  }
  const output = await dockerCapture(
    [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "label=com.docker.compose.service=postgres",
      "--format",
      "{{.Names}}"
    ],
    "discover the control-plane database in the current Compose project",
    signal
  );
  const candidates = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length !== 1) {
    throw new Error(
      "Control-plane database discovery requires exactly one postgres service in the current Compose project."
    );
  }
  const [container] = candidates;
  assertContainerName(container);
  return container;
}

async function currentComposeProject(signal?: AbortSignal): Promise<string | null> {
  try {
    const project = await dockerCapture(
      ["inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', hostname()],
      "determine the current Compose project",
      signal
    );
    return project.trim() || null;
  } catch {
    return null;
  }
}

async function pinnedPgvectorImage(
  configuredImage: string,
  imageId: string,
  sourceVersion: string,
  signal?: AbortSignal
): Promise<string> {
  const imageName = configuredImage.split("@")[0] ?? "";
  const imageMatch =
    /^(?:docker\.io\/)?pgvector\/pgvector:pg(?<major>[1-9]\d*)(?:[._-][A-Za-z0-9._-]+)?$/i.exec(
      imageName
    );
  const sourceMajor = sourceVersion.split(".")[0];
  if (!imageMatch?.groups?.major || imageMatch.groups.major !== sourceMajor) {
    throw new Error(
      "Control-plane recovery requires the source pgvector image for the source PostgreSQL major version."
    );
  }
  const repoDigest = await dockerCapture(
    ["image", "inspect", "--format", "{{index .RepoDigests 0}}", imageId],
    "inspect the source pgvector image digest",
    signal
  );
  const digest = repoDigest.trim().split("@")[1] ?? "";
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(
      "Control-plane recovery requires a locally available pgvector image pinned by repository digest."
    );
  }
  return `${imageName}@${digest}`;
}

async function containerPostgresIdentifier(
  containerName: string,
  variable: "POSTGRES_DB" | "POSTGRES_USER",
  fallback: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const value = (
      await dockerCapture(
        ["exec", containerName, "printenv", variable],
        "read non-secret control-plane database metadata",
        signal
      )
    ).trim();
    assertPostgresIdentifier(value);
    return value;
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallback;
  }
}

function parsePostgresVersion(output: string): string {
  const match = /PostgreSQL\)\s+([1-9]\d*(?:\.\d+(?:\.\d+)?)?)/i.exec(output);
  if (!match?.[1]) throw new Error("Could not determine the control-plane PostgreSQL version.");
  return match[1];
}

function assertContainerName(value: string): void {
  if (!CONTAINER_NAME_PATTERN.test(value))
    throw new Error("Control-plane PostgreSQL container name is invalid.");
}

function assertPostgresIdentifier(value: string): void {
  if (!POSTGRES_IDENTIFIER_PATTERN.test(value))
    throw new Error("Control-plane PostgreSQL identifier is invalid.");
}
