import { useState } from "react";
import type { SwarmTopologySnapshot } from "@daoflow/shared";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

export function SwarmPanel(props: {
  topology: SwarmTopologySnapshot | null;
  canRun: boolean;
  isPending: boolean;
  onRefreshTopology: () => void;
  onNodeAvailability: (input: {
    node: string;
    availability: "active" | "pause" | "drain";
    dryRun: boolean;
  }) => void;
  onServiceScale: (input: { service: string; replicas: number; dryRun: boolean }) => void;
}) {
  const [node, setNode] = useState("");
  const [availability, setAvailability] = useState<"active" | "pause" | "drain">("drain");
  const [service, setService] = useState("");
  const [replicas, setReplicas] = useState("1");
  const parsedReplicas = Number.parseInt(replicas, 10);
  const canSubmitNode = props.canRun && node.trim().length > 0 && !props.isPending;
  const canSubmitScale =
    props.canRun &&
    service.trim().length > 0 &&
    Number.isInteger(parsedReplicas) &&
    parsedReplicas >= 0 &&
    !props.isPending;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network size={15} />
            Swarm Topology
          </CardTitle>
          <Button
            size="sm"
            onClick={props.onRefreshTopology}
            disabled={!props.canRun || props.isPending}
            data-testid="server-swarm-refresh"
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {props.topology ? (
            <>
              <p className="text-muted-foreground">
                {props.topology.clusterName} · {props.topology.source} ·{" "}
                {props.topology.summary.nodeCount} nodes
              </p>
              <div className="space-y-2">
                {props.topology.nodes.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border p-3"
                    data-testid={`server-swarm-node-${entry.id}`}
                  >
                    <p className="font-medium">{entry.name}</p>
                    <p className="text-muted-foreground">
                      {entry.role} · {entry.managerStatus} · {entry.availability} ·{" "}
                      {entry.reachability}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No Swarm topology has been observed yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Swarm Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="swarm-node-target">Node</Label>
            <Input
              id="swarm-node-target"
              value={node}
              onChange={(event) => setNode(event.target.value)}
              placeholder="Node ID or hostname"
              data-testid="server-swarm-node-target"
            />
            <Label htmlFor="swarm-node-availability">Availability</Label>
            <Select
              value={availability}
              onValueChange={(value) => {
                if (value === "active" || value === "pause" || value === "drain") {
                  setAvailability(value);
                }
              }}
            >
              <SelectTrigger id="swarm-node-availability" data-testid="server-swarm-availability">
                <SelectValue placeholder="Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="pause">pause</SelectItem>
                <SelectItem value="drain">drain</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canSubmitNode}
                onClick={() => props.onNodeAvailability({ node, availability, dryRun: true })}
                data-testid="server-swarm-node-plan"
              >
                Plan Node
              </Button>
              <Button
                size="sm"
                disabled={!canSubmitNode}
                onClick={() => props.onNodeAvailability({ node, availability, dryRun: false })}
                data-testid="server-swarm-node-apply"
              >
                Apply Node
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="swarm-service-target">Service</Label>
            <Input
              id="swarm-service-target"
              value={service}
              onChange={(event) => setService(event.target.value)}
              placeholder="Swarm service name"
              data-testid="server-swarm-service-target"
            />
            <Label htmlFor="swarm-service-replicas">Replicas</Label>
            <Input
              id="swarm-service-replicas"
              type="number"
              min={0}
              value={replicas}
              onChange={(event) => setReplicas(event.target.value)}
              placeholder="Replicas"
              data-testid="server-swarm-service-replicas"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canSubmitScale}
                onClick={() =>
                  props.onServiceScale({ service, replicas: parsedReplicas, dryRun: true })
                }
                data-testid="server-swarm-scale-plan"
              >
                Plan Scale
              </Button>
              <Button
                size="sm"
                disabled={!canSubmitScale}
                onClick={() =>
                  props.onServiceScale({ service, replicas: parsedReplicas, dryRun: false })
                }
                data-testid="server-swarm-scale-apply"
              >
                Apply Scale
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
