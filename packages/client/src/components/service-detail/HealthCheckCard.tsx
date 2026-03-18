import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Save } from "lucide-react";
import { useState } from "react";

interface HealthCheckCardProps {
  healthcheckPath: string | null;
  port: string | null;
}

export function HealthCheckCard({ healthcheckPath, port }: HealthCheckCardProps) {
  const [hcCommand, setHcCommand] = useState(
    healthcheckPath
      ? `curl -f http://localhost:${port ?? "3000"}${healthcheckPath}`
      : ""
  );
  const [hcInterval, setHcInterval] = useState("30");
  const [hcTimeout, setHcTimeout] = useState("10");
  const [hcRetries, setHcRetries] = useState("3");
  const [hcStartPeriod, setHcStartPeriod] = useState("15");

  return (
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
  );
}
