import { ResourceLimitsCard } from "./ResourceLimitsCard";
import { RestartPolicyCard } from "./RestartPolicyCard";
import { HealthCheckCard } from "./HealthCheckCard";
import { VolumesCard } from "./VolumesCard";
import { NetworksCard } from "./NetworksCard";

interface AdvancedTabProps {
  serviceId: string;
  service: {
    healthcheckPath?: string | null;
    port?: string | null;
  };
}

export default function AdvancedTab({ serviceId: _serviceId, service }: AdvancedTabProps) {
  return (
    <div className="space-y-4">
      <ResourceLimitsCard />
      <RestartPolicyCard />
      <HealthCheckCard
        healthcheckPath={service.healthcheckPath ?? null}
        port={service.port ?? null}
      />
      <VolumesCard />
      <NetworksCard />
    </div>
  );
}
