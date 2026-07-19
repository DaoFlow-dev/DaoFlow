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
    callback_urls: [`${webhookUrl}/api/github/setup`],
    public: false,
    request_oauth_on_install: true,
    default_permissions: {
      contents: "read",
      metadata: "read",
      emails: "read",
      deployments: "write",
      pull_requests: "write"
    },
    default_events: ["pull_request", "push"]
  };
}
