export interface RepositoryPreparationConfig {
  submodules: boolean;
  gitLfs: boolean;
}

export interface RepositoryPreparationInput {
  submodules?: boolean;
  gitLfs?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readRepositoryPreparationConfig(value: unknown): RepositoryPreparationConfig {
  const record = asRecord(value);

  return {
    submodules: record.submodules === true,
    gitLfs: record.gitLfs === true
  };
}

export function hasRepositoryPreparation(config: RepositoryPreparationConfig): boolean {
  return config.submodules || config.gitLfs;
}

export function mergeRepositoryPreparationConfig(
  config: Record<string, unknown>,
  input: RepositoryPreparationInput
): Record<string, unknown> {
  if (input.submodules === undefined && input.gitLfs === undefined) {
    return config;
  }

  const current = readRepositoryPreparationConfig(asRecord(config.repositoryPreparation));
  const next = {
    submodules: input.submodules ?? current.submodules,
    gitLfs: input.gitLfs ?? current.gitLfs
  };

  if (!hasRepositoryPreparation(next)) {
    const { repositoryPreparation: _removed, ...rest } = config;
    return rest;
  }

  return {
    ...config,
    repositoryPreparation: next
  };
}
