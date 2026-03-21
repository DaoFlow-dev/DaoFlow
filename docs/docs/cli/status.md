---
sidebar_position: 4
---

# daoflow status

Show the current control-plane health and persisted server readiness status.

## Usage

```bash
daoflow status [options]
```

## Options

| Flag     | Description            |
| -------- | ---------------------- |
| `--json` | Structured JSON output |

## Required Scope

`server:read`

## Examples

```bash
# Human-readable status
daoflow status

# JSON for agents
daoflow status --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "context": "local",
    "apiUrl": "http://localhost:3000",
    "health": {
      "status": "healthy",
      "service": "daoflow-control-plane",
      "timestamp": "2026-03-20T22:30:00.000Z"
    },
    "servers": {
      "summary": {
        "totalServers": 2,
        "readyServers": 1,
        "attentionServers": 1,
        "blockedServers": 0,
        "pollIntervalMs": 60000,
        "averageLatencyMs": 50
      },
      "checks": [
        {
          "serverId": "srv_prod",
          "serverName": "production-vps",
          "serverHost": "203.0.113.10",
          "targetKind": "docker-engine",
          "swarmTopology": null,
          "serverStatus": "ready",
          "readinessStatus": "ready",
          "statusTone": "healthy",
          "sshPort": 22,
          "sshReachable": true,
          "dockerReachable": true,
          "composeReachable": true,
          "dockerVersion": "24.0.7",
          "composeVersion": "2.23.0",
          "latencyMs": 42,
          "checkedAt": "2026-03-20T22:29:30.000Z",
          "issues": [],
          "recommendedActions": ["No action required."]
        },
        {
          "serverId": "srv_swarm",
          "serverName": "swarm-mgr-1",
          "serverHost": "203.0.113.20",
          "targetKind": "docker-swarm-manager",
          "swarmTopology": {
            "clusterId": "swarm-srv_swarm",
            "clusterName": "production-swarm",
            "source": "manual",
            "defaultNamespace": "apps",
            "summary": {
              "nodeCount": 2,
              "managerCount": 1,
              "workerCount": 1,
              "activeNodeCount": 2,
              "reachableNodeCount": 1
            },
            "nodes": [
              {
                "id": "srv_swarm-manager",
                "name": "swarm-mgr-1",
                "host": "203.0.113.20",
                "role": "manager",
                "availability": "active",
                "reachability": "reachable",
                "managerStatus": "leader"
              },
              {
                "id": "srv_swarm-worker-1",
                "name": "worker-a",
                "host": "203.0.113.21",
                "role": "worker",
                "availability": "active",
                "reachability": "unknown",
                "managerStatus": "none"
              }
            ]
          },
          "serverStatus": "attention",
          "readinessStatus": "attention",
          "statusTone": "running",
          "sshPort": 22,
          "sshReachable": true,
          "dockerReachable": true,
          "composeReachable": true,
          "dockerVersion": "24.0.7",
          "composeVersion": "2.23.0",
          "latencyMs": 58,
          "checkedAt": "2026-03-20T22:29:50.000Z",
          "issues": ["One worker is still being drained."],
          "recommendedActions": ["Verify replacement capacity before re-enabling the drained node."]
        }
      ]
    }
  }
}
```
