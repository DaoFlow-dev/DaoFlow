/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/index",
        "getting-started/installation",
        "getting-started/first-deployment",
        "getting-started/configuration",
        "development"
      ]
    },
    {
      type: "category",
      label: "Core Concepts",
      items: [
        "concepts/index",
        "concepts/architecture",
        "concepts/projects-and-environments",
        "concepts/servers",
        "concepts/deployments",
        "concepts/services",
        "concepts/vision"
      ]
    },
    {
      type: "category",
      label: "CLI Reference",
      items: [
        "cli/index",
        "cli/auth",
        "cli/deploy",
        "cli/status",
        "cli/rollback",
        "cli/logs",
        "cli/env",
        "cli/plan",
        "cli/doctor",
        "cli/whoami",
        "cli/capabilities"
      ]
    },
    {
      type: "category",
      label: "API Reference",
      items: [
        "api/index",
        "api/authentication",
        "api/read-endpoints",
        "api/planning-endpoints",
        "api/command-endpoints",
        "api/error-handling"
      ]
    },
    {
      type: "category",
      label: "Security & RBAC",
      items: [
        "security/index",
        "security/roles",
        "security/scopes",
        "security/api-tokens",
        "security/agent-principals",
        "security/audit-trail"
      ]
    },
    {
      type: "category",
      label: "Deployments",
      items: [
        "deployments/index",
        "deployments/compose",
        "deployments/dockerfile",
        "deployments/image",
        "deployments/rollback",
        "deployments/logs"
      ]
    },
    {
      type: "category",
      label: "Backup & Restore",
      items: [
        "backups/index",
        "backups/policies",
        "backups/runs",
        "backups/restore",
        "backups/s3-storage"
      ]
    },
    {
      type: "category",
      label: "Agent Integration",
      items: [
        "agents/index",
        "agents/getting-started",
        "agents/cli-for-agents",
        "agents/api-for-agents",
        "agents/safety-model",
        "agents/approval-gates"
      ]
    },
    {
      type: "category",
      label: "Self-Hosting",
      items: [
        "self-hosting/index",
        "self-hosting/requirements",
        "self-hosting/docker-compose",
        "self-hosting/environment-variables",
        "self-hosting/ssl-and-domains",
        "self-hosting/upgrading"
      ]
    },
    {
      type: "category",
      label: "Contributing",
      items: [
        "contributing/index",
        "contributing/development-setup",
        "contributing/architecture-guide",
        "contributing/testing",
        "contributing/code-style"
      ]
    },
    {
      type: "category",
      label: "Comparisons",
      items: [
        "comparisons/index",
        "comparisons/vs-vercel",
        "comparisons/vs-coolify-dokploy",
        "comparisons/vs-cloud-providers",
        "comparisons/vs-kamal"
      ]
    }
  ]
};

export default sidebars;
