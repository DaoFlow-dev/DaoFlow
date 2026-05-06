export const DEFAULT_HOST_RUNNER_PROFILE_ID = "runner_profile_host_default";
export const DEFAULT_BOXLITE_RUNNER_PROFILE_ID = "runner_profile_boxlite_default";
export const DEFAULT_CODEX_HOME_PATH = "/runner/home/.codex";
export const DEFAULT_CODEX_CONFIG_PATH = `${DEFAULT_CODEX_HOME_PATH}/config.toml`;
export const DEFAULT_CODEX_AUTH_MODE = "custom_provider_env";

export const DEFAULT_CODEX_CONFIG_TEMPLATE = [
  'profile = "daoflow"',
  "",
  "[profiles.daoflow]",
  'approval_policy = "never"',
  'sandbox_mode = "workspace-write"',
  'model_provider = "openai"',
  "",
  "[model_providers.openai]",
  'name = "OpenAI"',
  'base_url = "https://api.openai.com/v1"',
  'env_key = "OPENAI_API_KEY"'
].join("\n");

export function defaultHostRunnerMetadata(input?: { hostServerDefault?: boolean }) {
  return {
    defaultTarget: "registered-host",
    hostServerDefault: Boolean(input?.hostServerDefault),
    codexAuthModes: ["api_key", "chatgpt_auth_json", "custom_provider_env"],
    codexHomePath: DEFAULT_CODEX_HOME_PATH,
    codexConfigPath: DEFAULT_CODEX_CONFIG_PATH,
    sandbankProvider: "host_docker",
    capabilities: [
      "exec",
      "exec.stream",
      "files.read",
      "files.write",
      "archive.upload",
      "archive.download"
    ],
    laterProvider: "sandbank_boxlite",
    laterPackage: "@sandbank.dev/boxlite",
    boxliteModes: ["remote", "local"]
  };
}

export function defaultBoxLiteRunnerMetadata(input?: { hostServerDefault?: boolean }) {
  return {
    defaultTarget: "registered-host",
    hostServerDefault: Boolean(input?.hostServerDefault),
    codexAuthModes: ["api_key", "chatgpt_auth_json", "custom_provider_env"],
    codexHomePath: DEFAULT_CODEX_HOME_PATH,
    codexConfigPath: DEFAULT_CODEX_CONFIG_PATH,
    sandbankProvider: "sandbank_boxlite",
    sandbankPackage: "@sandbank.dev/boxlite",
    boxliteMode: "remote",
    boxliteModes: ["remote", "local"],
    capabilities: [
      "exec",
      "exec.stream",
      "files.read",
      "files.write",
      "archive.upload",
      "archive.download",
      "snapshot",
      "port.expose",
      "terminal",
      "sleep"
    ]
  };
}
