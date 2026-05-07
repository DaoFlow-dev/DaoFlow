export function normalizeGitHubAppNameSegment(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function generateManifestAppName(): string {
  const random = Math.random().toString(36).slice(2, 8);
  const date = new Date().toISOString().split("T")[0];
  return `DaoFlow-${date}-${random}`;
}

export function buildGitHubManifest(baseUrl: string, webhookUrl: string) {
  return {
    name: generateManifestAppName(),
    url: baseUrl,
    hook_attributes: {
      url: `${webhookUrl}/api/webhooks/github`,
      active: true
    },
    redirect_url: `${webhookUrl}/api/github/setup`,
    callback_urls: [`${baseUrl}/settings/git/callback`],
    setup_url: `${webhookUrl}/api/github/setup`,
    setup_on_updates: true,
    public: false,
    request_oauth_on_install: true,
    default_permissions: {
      contents: "read",
      metadata: "read",
      emails: "read",
      pull_requests: "write"
    },
    default_events: ["pull_request", "push"]
  };
}
