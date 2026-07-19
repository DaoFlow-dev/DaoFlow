---
sidebar_position: 2
---

# Compose Deployments

Docker Compose is the primary deployment method in DaoFlow. Compose files are first-class citizens — DaoFlow preserves both the original file and the rendered runtime spec.

## How It Works

1. You provide a `compose.yaml` file
2. DaoFlow uploads or checks out the deployment workspace on the target server
3. If the rendered Compose spec contains local `build:` services, DaoFlow builds them before start
4. Runs `docker compose up -d` with the appropriate project name
5. Waits for Docker Compose container state and Docker health
6. If configured, runs an explicit readiness probe from the deployment target host and records the outcome

## CLI Deployment

```bash
# Preview
daoflow deploy --compose ./compose.yaml --server srv_prod --dry-run

# Deploy
daoflow deploy --compose ./compose.yaml --server srv_prod --yes
```

## Example Compose File

```yaml
services:
  web:
    image: node:20-alpine
    command: npm start
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
    volumes:
      - app-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  app-data:
  redis-data:
```

## What DaoFlow Stores

For each Compose deployment, DaoFlow records:

- **Original compose.yaml** — the file as provided
- **Resolved config** — with environment variables substituted
- **Image tags** — exact versions pulled
- **Volume mounts** — persistent storage configuration
- **Environment variables** — encrypted values used at deploy time

## Multi-Service Support

Compose files with multiple services are deployed as a unit. All services start together, and the deployment is marked as successful only when all services are healthy.

## Explicit Readiness Probes

Compose deployments can opt into an explicit readiness probe on the DaoFlow service definition:

```json
{
  "readinessProbe": {
    "type": "http",
    "target": "published-port",
    "port": 8080,
    "path": "/ready",
    "host": "127.0.0.1",
    "scheme": "http",
    "timeoutSeconds": 60,
    "intervalSeconds": 3,
    "successStatusCodes": [200, 204]
  }
}
```

Supported readiness probe shapes:

- HTTP against a host-published endpoint
- HTTP against the compose internal network for the targeted compose service
- TCP against a host-published port
- TCP against the compose internal network for the targeted compose service

Execution semantics are deterministic:

- DaoFlow probes from the deployment target host, not from the control plane browser session.
- `target: "published-port"` checks the configured host/port directly from that host.
- `target: "internal-network"` resolves the running compose container addresses for the targeted compose service and checks each running replica.
- Docker Compose container state and Docker health must pass before the readiness probe can promote the rollout.
- Remote HTTP probes need `curl` available so the worker can execute the probe over SSH from the host that is actually running the Compose project.
- Remote TCP probes use `bash` plus `timeout` on the target host to test raw socket connectivity.
- Legacy `healthcheckPath` metadata is still stored for compatibility, but compose services should migrate to explicit `readinessProbe` configuration because `healthcheckPath` is not executed as a rollout gate.

## Environment Variable Injection

DaoFlow injects environment variables from the project's environment configuration into the Compose file using `docker compose --env-file`:

```bash
daoflow env set --env-id env_prod_123 \
  --key DATABASE_URL \
  --value postgresql://... \
  --yes
```

These are then available in your `compose.yaml` via `${DATABASE_URL}`.

For git-backed Compose deployments, DaoFlow also generates a redacted shell export file so remote SSH execution sees the same resolved build/runtime environment surface as local execution. This is what allows Compose `build:` services and environment-backed BuildKit secret references to behave consistently on the target host without leaking secret values into logs or persisted plan artifacts.

## Preview Lifecycle Automation

Preview-enabled compose services can also reconcile preview stacks directly from provider webhooks when the project has webhook auto-deploy enabled:

- GitHub pushes to non-auto-deploy branches queue branch preview deploys for services that allow branch previews.
- GitHub branch deletion pushes queue branch preview cleanup for the matching shadow environment.
- GitHub pull request `opened`, `synchronize`, and `reopened` events are classified by source
  repository and project preview policy before any preview deployment input is prepared.
- GitHub pull request `closed` events queue preview cleanup.
- GitLab merge request `open`, `update`, and `reopen` events are classified by source repository
  and project preview policy before any preview deployment input is prepared.
- GitLab merge request `merge` and `close` events queue preview cleanup.

Pull-request previews default to **manual approval**. The approval queue binds a decision to the
provider, source repository, full immutable commit SHA, project policy revision, allowed secret
profile, expiry, and approving human. A changed project policy invalidates prior bindings.
Same-repository code is never trusted automatically; the only enabled policy requires a human
approval for every commit. Fork previews are blocked; DaoFlow does not offer a fork-without-secrets
mode until it has an isolated preview runner and a Compose capability policy.

DaoFlow records each branch or pull-request preview as a durable shadow environment attached to the base service. The shadow environment stores the preview key, branch, PR number when present, env branch, stack name, primary domain, lifecycle status, cleanup state, and latest deployment pointer. Deployment history remains the audit log, but the UI, API, and CLI can list preview environments directly instead of reconstructing them from the latest deployment.

## Git Provider Setup

Git-backed Compose projects can be attached to a registered provider during project creation.
Register the provider in Git settings, connect the installation or OAuth account, then create the
project from the setup wizard, the Projects page, or the CLI with:

- Git provider
- Git installation
- repository full name, such as `acme/api`
- default branch
- auto-deploy branch
- Compose path, such as `compose.yaml` or `deploy/compose.yaml`

For GitHub App projects, install the app into the target account, select that installation during
project creation, enable webhook auto-deploy when branch pushes should deploy automatically, choose
the pull-request preview policy in the Project page, and configure preview behavior on the Compose
service after the project exists. GitHub pull request events then request approval before deployment,
or clean up a preview after closure. GitHub branch pushes that
do not target the project's auto-deploy branch drive branch previews when the service preview mode is
`branch` or `any`.

### GitHub deployment status and preview comments

DaoFlow GitHub Apps request `deployments: write` so linked branch and pull-request deployments are
visible from the GitHub commit and pull request. DaoFlow creates one GitHub Deployment for each
DaoFlow deployment, publishes queued, running, success, failure, cancellation, and preview-cleanup
state, and keeps one status comment per project pull request instead of posting a new comment for
every retry or commit.

The GitHub status links back to the exact DaoFlow deployment and its logs. A public environment or
preview link is included only after the deployment succeeds and DaoFlow observes the configured
route as active. Blocked previews, pending approvals, failed deployments, missing routes, and stale
or inactive routes do not publish an environment URL.

Apps created after this feature is installed request the permission during setup. Existing GitHub App
installations must approve the requested permission update before delivery can succeed:

1. As the GitHub App owner, open **Developer settings → GitHub Apps → your DaoFlow App →
   Permissions & events**.
2. Set **Deployments** to **Read and write**, keep **Pull requests** at **Read and write**, and save
   the App changes.
3. As the target account or organization owner, open the installed App and approve the pending
   permission request.
4. Trigger a new deployment after the installation has the new permission. Any earlier blocked
   feedback remains visible in DaoFlow's provider-feedback history for audit purposes.

GitHub does not activate newly requested permissions for an existing installation until an owner
approves them. See GitHub's
[permission-update guide](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app),
[App registration guide](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration),
[Deployments API](https://docs.github.com/en/rest/deployments/deployments), and
[deployment status API](https://docs.github.com/en/rest/deployments/statuses). GitHub Enterprise uses
the API base URL configured on the DaoFlow provider.

### GitLab commit status and merge-request notes

DaoFlow publishes one stable commit-status context for every GitLab-backed deployment. Pushes and
branch previews receive that status only; merge-request previews receive the same status plus one
durable merge-request note. The note is updated as deployment work is queued, running, completed,
failed, canceled, or cleaned up instead of posting a new note for every transition or retry.

Each status and note links back to the exact DaoFlow deployment record and its logs. A preview link
appears only after a successful preview deployment when DaoFlow can verify that the exact route is
active. Cleanup, blocked previews, failed deployments, and missing or inactive routes omit that
link.

GitLab feedback uses the OAuth or API-token credentials described below. Deploy tokens remain
clone-only: DaoFlow records a safe provider-feedback warning and does not call GitLab when an
API-capable credential is missing. For self-hosted GitLab, DaoFlow sends API traffic to the optional
internal GitLab URL while the configured public URL continues to identify the GitLab instance to
users and webhooks. DaoFlow does not create GitLab Deployment API records for this integration.

For GitLab.com, register a GitLab provider with the GitLab OAuth app client ID, client secret, and
webhook secret. The OAuth callback URL is:

```text
https://<daoflow-host>/settings/git/callback
```

The webhook URL is:

```text
https://<daoflow-host>/api/webhooks/gitlab
```

Set the GitLab webhook secret token to the same secret stored on the provider. Use push and merge
request events for auto-deploy and preview lifecycle automation.

For self-hosted GitLab, set the provider base URL to the root GitLab URL, for example
`https://gitlab.example.com`. Use the same callback URL and webhook URL shown above, but create the
OAuth application and webhook inside the self-hosted GitLab instance. DaoFlow uses the provider base
URL when exchanging OAuth codes, validating source access, and matching webhook project URLs, so the
same `group/project` path can exist safely on GitLab.com and a self-hosted GitLab host.

### GitLab credential modes, scopes, and routing

Choose the GitLab credential that matches the integration you need:

- **OAuth (recommended):** create a GitLab OAuth application and provide its client ID and secret.
  Request the `api` and `read_repository` scopes for repository checkout, deployment feedback, and
  other provider API calls.
  DaoFlow uses PKCE and one-time callback state during authorization, stores the refresh token
  securely, and refreshes the access token before it expires. See GitLab's
  [OAuth provider documentation](https://docs.gitlab.com/integration/oauth_provider/) and
  [OAuth API documentation](https://docs.gitlab.com/api/oauth2/).
- **Project or group API token:** create a project or group access token and grant `api`. Add
  `read_repository` when the token will also be used for HTTPS cloning. This mode supports GitLab
  API operations and deployment or merge-request feedback. See GitLab's
  [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/) and
  [group access token](https://docs.gitlab.com/user/group/settings/group_access_tokens/) guides.
- **Deploy token:** create a project or group deploy token with `read_repository`. DaoFlow uses it
  for repository cloning only; it cannot call the GitLab API or publish feedback. Set an expiry date
  and rotate the token before it expires. See GitLab's
  [deploy token documentation](https://docs.gitlab.com/user/project/deploy_tokens/).

The **Public GitLab URL** is the externally reachable GitLab root used for OAuth authorization,
public webhook/source URL matching, and browser links. For a self-hosted instance, the optional
**Internal GitLab URL** lets the DaoFlow server use a private route for GitLab API and clone traffic
while keeping the public URL in the provider configuration. Leave the internal URL empty to use the
public URL for both paths. The internal address must resolve from the DaoFlow server and have a
trusted TLS certificate; DaoFlow does not disable TLS verification. Use an explicitly configured CA
trust chain when a private certificate authority is required.

Credential mode, intended scopes, expiry, and Clone/API/Feedback capabilities are visible on the
provider card. Secret values are not displayed after registration.

Preview config can also carry a retention window through `staleAfterHours`. When set, DaoFlow can compare the latest preview deployment state against observed tunnel-route hostnames and queue Compose preview cleanup for terminal preview stacks that outlive the configured window.

On the service detail page, the Environment tab now shows preview lifecycle state as a first-class operator surface:

- Preview mode, managed domain template, and cleanup retention policy
- Each tracked preview branch or pull request, including stack name and preview env branch
- Whether the preview is active, stale, failed, cleaning, or already cleaned up
- Why DaoFlow is keeping the preview around and what event or action will remove it
- Manual preview retirement plus dry-run or live cleanup execution when the operator has deploy permissions

The CLI exposes the same records with `daoflow services previews --service <id> --json`. Environment variable inventory can also resolve directly against a shadow environment with `daoflow env list --preview-env <id> --json`, which applies branch-pattern variables to the preview env branch rather than relying on a caller-supplied branch string.

That UI keeps preview-specific cleanup isolated from the base environment, so clearing a preview does not flatten or mutate the long-lived environment configuration.
