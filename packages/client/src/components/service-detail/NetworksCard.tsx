import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

export function NetworksCard() {
  const [networks, setNetworks] = useState<string[]>(["default"]);
  const [newNetwork, setNewNetwork] = useState("");

  function addNetwork() {
    if (!newNetwork.trim() || networks.includes(newNetwork.trim())) return;
    setNetworks((prev) => [...prev, newNetwork.trim()]);
    setNewNetwork("");
  }

  function removeNetwork(name: string) {
    setNetworks((prev) => prev.filter((n) => n !== name));
  }

  return (
    <Card className="shadow-sm">
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
  );
}
