import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Plus,
  Trash2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Cable
} from "lucide-react";
import { useState } from "react";

interface DomainsTabProps {
  serviceId: string;
  serviceName: string;
}

interface Domain {
  id: string;
  hostname: string;
  sslStatus: "valid" | "expiring" | "expired" | "pending" | "none";
  isPrimary: boolean;
  createdAt: string;
}

interface PortMapping {
  id: string;
  hostPort: string;
  containerPort: string;
  protocol: "tcp" | "udp";
}

export default function DomainsTab({
  serviceId: _serviceId,
  serviceName: _serviceName
}: DomainsTabProps) {
  // Placeholder state — these will be backed by tRPC once the server procedures exist
  const [domains, setDomains] = useState<Domain[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [newHostPort, setNewHostPort] = useState("");
  const [newContainerPort, setNewContainerPort] = useState("");

  function addDomain() {
    if (!newDomain.trim()) return;
    setDomains((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        hostname: newDomain.trim(),
        sslStatus: "pending",
        isPrimary: prev.length === 0,
        createdAt: new Date().toISOString()
      }
    ]);
    setNewDomain("");
  }

  function removeDomain(id: string) {
    setDomains((prev) => prev.filter((d) => d.id !== id));
  }

  function addPort() {
    if (!newHostPort || !newContainerPort) return;
    setPorts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        hostPort: newHostPort,
        containerPort: newContainerPort,
        protocol: "tcp"
      }
    ]);
    setNewHostPort("");
    setNewContainerPort("");
  }

  function removePort(id: string) {
    setPorts((prev) => prev.filter((p) => p.id !== id));
  }

  function sslIcon(status: Domain["sslStatus"]) {
    switch (status) {
      case "valid":
        return <ShieldCheck size={14} className="text-green-500" />;
      case "expiring":
        return <Shield size={14} className="text-yellow-500" />;
      case "expired":
        return <ShieldAlert size={14} className="text-red-500" />;
      default:
        return <Shield size={14} className="text-muted-foreground" />;
    }
  }

  return (
    <div className="space-y-6">
      {/* Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe size={14} />
            Custom Domains
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Add domain */}
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => e.key === "Enter" && addDomain()}
            />
            <Button size="sm" onClick={addDomain} disabled={!newDomain.trim()}>
              <Plus size={14} className="mr-1" />
              Add
            </Button>
          </div>

          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No custom domains configured. Add one above or the service will be accessible via IP.
            </p>
          ) : (
            <div className="space-y-2">
              {domains.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between py-2 px-3 rounded border"
                >
                  <div className="flex items-center gap-3">
                    {sslIcon(d.sslStatus)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{d.hostname}</span>
                        {d.isPrimary && (
                          <Badge variant="default" className="text-xs">
                            Primary
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        SSL: <span className="capitalize">{d.sslStatus}</span> · Added{" "}
                        {new Date(d.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(`https://${d.hostname}`, "_blank")}
                      title="Open"
                    >
                      <ExternalLink size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => removeDomain(d.id)}
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Port Mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Cable size={14} />
            Port Mappings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Add port */}
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="Host port"
              value={newHostPort}
              onChange={(e) => setNewHostPort(e.target.value)}
              className="h-8 text-sm w-28"
              type="number"
            />
            <span className="text-muted-foreground">:</span>
            <Input
              placeholder="Container port"
              value={newContainerPort}
              onChange={(e) => setNewContainerPort(e.target.value)}
              className="h-8 text-sm w-28"
              type="number"
            />
            <Button size="sm" onClick={addPort} disabled={!newHostPort || !newContainerPort}>
              <Plus size={14} className="mr-1" />
              Add
            </Button>
          </div>

          {ports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No explicit port mappings. Ports are defined in your compose file or Dockerfile.
            </p>
          ) : (
            <div className="space-y-2">
              {ports.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 px-3 rounded border"
                >
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span>{p.hostPort}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{p.containerPort}</span>
                    <Badge variant="outline" className="text-xs">
                      {p.protocol}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removePort(p.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reverse Proxy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield size={14} />
            Reverse Proxy Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Reverse proxy rules (Traefik/Caddy labels) are configured automatically from your
            domains and compose file. Advanced configuration can be edited in the compose file
            directly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
