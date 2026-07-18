export const INSTALL_WORKFLOW_PROFILES = ["lean", "temporal"] as const;

export type InstallWorkflowProfile = (typeof INSTALL_WORKFLOW_PROFILES)[number];

export const INSTALL_WORKFLOW_PROFILE_CHOICES: Array<{
  label: string;
  value: InstallWorkflowProfile;
}> = [
  {
    label: "Lean — DaoFlow, PostgreSQL, and Redis",
    value: "lean"
  },
  {
    label: "Temporal — adds workflow orchestration services",
    value: "temporal"
  }
];

export function parseInstallWorkflowProfile(
  value: string | undefined
): InstallWorkflowProfile | null {
  const profile = value?.trim().toLowerCase();
  return profile === "lean" || profile === "temporal" ? profile : null;
}

export function inferInstallWorkflowProfile(env: Record<string, string>): InstallWorkflowProfile {
  const persistedProfile = parseInstallWorkflowProfile(env.DAOFLOW_WORKFLOW_PROFILE);
  if (persistedProfile) {
    return persistedProfile;
  }

  return env.DAOFLOW_ENABLE_TEMPORAL?.trim().toLowerCase() === "true" ? "temporal" : "lean";
}

export function getInstallWorkflowProfileEnv(
  profile: InstallWorkflowProfile
): Record<"COMPOSE_PROFILES" | "DAOFLOW_ENABLE_TEMPORAL" | "DAOFLOW_WORKFLOW_PROFILE", string> {
  const temporalEnabled = profile === "temporal";
  return {
    DAOFLOW_WORKFLOW_PROFILE: profile,
    COMPOSE_PROFILES: temporalEnabled ? "temporal" : "",
    DAOFLOW_ENABLE_TEMPORAL: temporalEnabled ? "true" : "false"
  };
}
