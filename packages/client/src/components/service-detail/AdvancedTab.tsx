import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Cpu, HardDrive, RefreshCw, Heart, Network, Plus, Trash2, Save } from "lucide-react";
import { useState } from "react";

interface AdvancedTabProps {
  serviceId: string;
  service: {
    healthcheckPath: string | null;
    port: string | null;
    replicaCount: string;
  };
}

interface Volume {
  id: string;
  hostPath: string;
  containerPath: string;
  mode: "rw" | "ro";
}

export default function AdvancedTab({ serviceId: _serviceId, service }: AdvancedTabProps) {
  // Resource limits
  const [cpuLimit, setCpuLimit] = useState("");
  const [cpuReservation, setCpuReservation] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("");
  const [memoryReservation, setMemoryReservation] = useState("");

  // Restart policy
  const [restartPolicy, setRestartPolicy] = useState("unless-stopped");
  const [maxRetries, setMaxRetries] = useState("3");

  // Health check
  const [hcCommand, setHcCommand] = useState(
    service.healthcheckPath
      ? `curl -f http://localhost:${service.port ?? "3000"}${service.healthcheckPath}`
      : ""
  );
  const [hcInterval, setHcInterval] = useState("30");
  const [hcTimeout, setHcTimeout] = useState("10");
  const [hcRetries, setHcRetries] = useState("3");
  const [hcStartPeriod, setHcStartPeriod] = useState("15");

  // Volumes
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [newHostPath, setNewHostPath] = useState("");
  const [newContainerPath, setNewContainerPath] = useState("");

  // Networks
  const [networks, setNetworks] = useState<string[]>(["default"]);
  const [newNetwork, setNewNetwork] = useState("");

  function addVolume() {
    if (!newHostPath || !newContainerPath) return;
    setVolumes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        hostPath: newHostPath,
        containerPath: newContainerPath,
        mode: "rw"
      }
    ]);
    setNewHostPath("");
    setNewContainerPath("");
  }

  function removeVolume(id: string) {
    setVolumes((prev) => prev.filter((v) => v.id !== id));
  }

  function addNetwork() {
    if (!newNetwork.trim() || networks.includes(newNetwork.trim())) return;
    setNetworks((prev) => [...prev, newNetwork.trim()]);
    setNewNetwork("");
  }

  function removeNetwork(name: string) {
    setNetworks((prev) => prev.filter((n) => n !== name));
  }

  return (
    <div className="space-y-6">
      {/* Resource Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu size={14} />
            Resource Limits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResourceInput
              label="CPU Limit"
              value={cpuLimit}
              onChange={setCpuLimit}
              placeholder="1.0 (cores)"
              step="0.25"
              hint="Maximum CPU cores (e.g. 2.0 = 2 cores)"
            />
            <ResourceInput
              label="CPU Reservation"
              value={cpuReservation}
              onChange={setCpuReservation}
              placeholder="0.5 (cores)"
              step="0.25"
              hint="Guaranteed minimum CPU"
            />
            <ResourceInput
              label="Memory Limit"
              value={memoryLimit}
              onChange={setMemoryLimit}
              placeholder="512 (MB)"
              step="128"
              hint="Hard memory limit in MB"
            />
            <ResourceInput
              label="Memory Reservation"
              value={memoryReservation}
              onChange={setMemoryReservation}
              placeholder="256 (MB)"
              step="128"
              hint="Soft memory limit in MB"
            />
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm">
              <Save size={14} className="mr-1" />
              Save Resources
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Restart Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw size={14} />
            Restart Policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Policy</label>
              <Select value={restartPolicy} onValueChange={setRestartPolicy}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Always</SelectItem>
                  <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                  <SelectItem value="on-failure">On Failure</SelectItem>
                  <SelectItem value="no">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {restartPolicy === "on-failure" && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Max Retries</label>
                <Input
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(e.target.value)}
                  className="h-8 text-sm"
                  type="number"
                  min="1"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm">
              <Save size={14} className="mr-1" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Health Check */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Heart size={14} />
            Health Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Command</label>
              <Input
                value={hcCommand}
                onChange={(e) => setHcCommand(e.target.value)}
                className="h-8 text-sm font-mono"
                placeholder="curl -f http://localhost:3000/health"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Interval (s)</label>
                <Input
                  value={hcInterval}
                  onChange={(e) => setHcInterval(e.target.value)}
                  className="h-8 text-sm"
                  type="number"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Timeout (s)</label>
                <Input
                  value={hcTimeout}
                  onChange={(e) => setHcTimeout(e.target.value)}
                  className="h-8 text-sm"
                  type="number"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Retries</label>
                <Input
                  value={hcRetries}
                  onChange={(e) => setHcRetries(e.target.value)}
                  className="h-8 text-sm"
                  type="number"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">
                  Start Period (s)
                </label>
                <Input
                  value={hcStartPeriod}
                  onChange={(e) => setHcStartPeriod(e.target.value)}
                  className="h-8 text-sm"
                  type="number"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm">
              <Save size={14} className="mr-1" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Volumes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive size={14} />
            Volumes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="Host path or volume name"
              value={newHostPath}
              onChange={(e) => setNewHostPath(e.target.value)}
              className="h-8 text-sm font-mono flex-1"
            />
            <span className="text-muted-foreground">:</span>
            <Input
              placeholder="Container path"
              value={newContainerPath}
              onChange={(e) => setNewContainerPath(e.target.value)}
              className="h-8 text-sm font-mono flex-1"
            />
            <Button size="sm" onClick={addVolume} disabled={!newHostPath || !newContainerPath}>
              <Plus size={14} className="mr-1" />
              Add
            </Button>
          </div>

          {volumes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No volumes configured. Volumes are typically defined in your compose file.
            </p>
          ) : (
            <div className="space-y-2">
              {volumes.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between py-2 px-3 rounded border"
                >
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span>{v.hostPath}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{v.containerPath}</span>
                    <Badge variant="outline" className="text-xs">
                      {v.mode}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeVolume(v.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Networks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Network size={14} />
            Networks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="Network name"
              value={newNetwork}
              onChange={(e) => setNewNetwork(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => e.key === "Enter" && addNetwork()}
            />
            <Button size="sm" onClick={addNetwork} disabled={!newNetwork.trim()}>
              <Plus size={14} className="mr-1" />
              Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {networks.map((n) => (
              <Badge key={n} variant="secondary" className="gap-1 pr-1">
                {n}
                {n !== "default" && (
                  <button className="ml-1 hover:text-destructive" onClick={() => removeNetwork(n)}>
                    ×
                  </button>
                )}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceInput({
  label,
  value,
  onChange,
  placeholder,
  step,
  hint
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  step: string;
  hint: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const n = Math.max(0, (parseFloat(value) || 0) - parseFloat(step));
            onChange(n.toString());
          }}
        >
          −
        </Button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm text-center"
          placeholder={placeholder}
          type="number"
          step={step}
          min="0"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const n = (parseFloat(value) || 0) + parseFloat(step);
            onChange(n.toString());
          }}
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
