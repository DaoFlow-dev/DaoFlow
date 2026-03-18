import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Box, Layers, CheckCircle, AlertCircle, Clock } from "lucide-react";

interface ProjectOverviewCardsProps {
  serviceCount: number;
  healthyCount: number;
  unhealthyCount: number;
  envCount: number;
  lastDeploy: { createdAt: string; status: string } | undefined;
}

export function ProjectOverviewCards({
  serviceCount,
  healthyCount,
  unhealthyCount,
  envCount,
  lastDeploy
}: ProjectOverviewCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Box size={14} />
            Services
          </div>
          <span className="text-2xl font-bold">{serviceCount}</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <CheckCircle size={14} className="text-green-500" />
            Healthy
          </div>
          <span className="text-2xl font-bold text-green-500">{healthyCount}</span>
          {unhealthyCount > 0 && (
            <span className="ml-2 text-sm text-red-400">
              <AlertCircle size={12} className="inline mr-0.5" />
              {unhealthyCount} unhealthy
            </span>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Layers size={14} />
            Environments
          </div>
          <span className="text-2xl font-bold">{envCount}</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Clock size={14} />
            Last Deploy
          </div>
          {lastDeploy ? (
            <div>
              <span className="text-sm">
                {new Date(lastDeploy.createdAt).toLocaleDateString()}
              </span>
              <Badge variant="secondary" className="ml-2 text-xs">
                {lastDeploy.status}
              </Badge>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Never</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
