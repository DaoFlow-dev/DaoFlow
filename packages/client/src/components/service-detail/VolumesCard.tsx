import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface Volume {
  id: string;
  hostPath: string;
  containerPath: string;
  mode: "rw" | "ro";
}

export function VolumesCard() {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [newHostPath, setNewHostPath] = useState("");
  const [newContainerPath, setNewContainerPath] = useState("");

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

  return (
    <Card className="shadow-sm">
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
  );
}
