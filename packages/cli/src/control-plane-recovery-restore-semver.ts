const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type SemanticVersion = {
  core: [string, string, string];
  prerelease: string[];
};

export function assertSemanticVersionCompatibility(
  installed: string,
  minimum: string,
  maximumExclusive: string
): void {
  const current = parseSemanticVersion(installed, "Installed DaoFlow version");
  const minimumVersion = parseSemanticVersion(minimum, "Recovery bundle minimum app version");
  const maximumVersion = parseSemanticVersion(
    maximumExclusive,
    "Recovery bundle maximum app version"
  );
  if (compareSemanticVersion(minimumVersion, maximumVersion) >= 0) {
    throw new Error("Recovery bundle compatibility range is invalid.");
  }
  if (
    compareSemanticVersion(current, minimumVersion) < 0 ||
    compareSemanticVersion(current, maximumVersion) >= 0
  ) {
    throw new Error(
      "Installed DaoFlow version is outside the recovery bundle compatibility range."
    );
  }
}

export function compareSemanticVersions(left: string, right: string): number {
  return compareSemanticVersion(
    parseSemanticVersion(left, "Left semantic version"),
    parseSemanticVersion(right, "Right semantic version")
  );
}

function parseSemanticVersion(value: string, label: string): SemanticVersion {
  const match = value.trim().match(SEMVER);
  const prerelease = match?.[4]?.split(".") ?? [];
  if (
    !match ||
    prerelease.some((identifier) => /^\d+$/.test(identifier) && !/^(0|[1-9]\d*)$/.test(identifier))
  ) {
    throw new Error(`${label} is not a valid semantic version.`);
  }
  return { core: [match[1], match[2], match[3]], prerelease };
}

function compareSemanticVersion(left: SemanticVersion, right: SemanticVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifier(left.core[index], right.core[index]);
    if (comparison !== 0) return comparison;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftIsNumeric = /^\d+$/.test(leftIdentifier);
    const rightIsNumeric = /^\d+$/.test(rightIdentifier);
    if (leftIsNumeric && rightIsNumeric) {
      const comparison = compareNumericIdentifier(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1;
    if (leftIdentifier !== rightIdentifier) return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
