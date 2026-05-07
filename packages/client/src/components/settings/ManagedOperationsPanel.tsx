import { LogDrainsSettingsPanel } from "./LogDrainsSettingsPanel";
import { ManagedTunnelsPanel } from "./ManagedTunnelsPanel";

export function ManagedOperationsPanel({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-8" data-testid="managed-operations-panel">
      <ManagedTunnelsPanel canManage={canManage} />
      <LogDrainsSettingsPanel canManage={canManage} />
    </div>
  );
}
