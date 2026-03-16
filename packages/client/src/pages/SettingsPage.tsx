import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { canAssumeAnyRole, normalizeAppRole, type AppRole } from "@daoflow/shared";
import { Settings, Users, KeyRound, Shield } from "lucide-react";

export default function SettingsPage() {
  const session = useSession();
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "guest";
  const isAdmin = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);

  return (
    <main className="shell">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Settings</h1>
          <p className="page-header__desc">General configuration and platform settings.</p>
        </div>
      </div>

      {!session.data ? (
        <div className="empty-state">
          <p>Sign in to access settings.</p>
        </div>
      ) : (
        <div className="settings-grid">
          <div className="settings-card">
            <div className="settings-card__icon">
              <Settings size={20} />
            </div>
            <h3 className="settings-card__title">General</h3>
            <p className="settings-card__desc">Platform name, version, and system information.</p>
          </div>

          <div className="settings-card">
            <div className="settings-card__icon">
              <Users size={20} />
            </div>
            <h3 className="settings-card__title">Users & Roles</h3>
            <p className="settings-card__desc">Manage team members, roles, and permissions.</p>
            {!isAdmin && <span className="badge badge--amber">Admin only</span>}
          </div>

          <div className="settings-card">
            <div className="settings-card__icon">
              <KeyRound size={20} />
            </div>
            <h3 className="settings-card__title">API Tokens</h3>
            <p className="settings-card__desc">
              Create and manage scoped API tokens for integrations.
            </p>
          </div>

          <div className="settings-card">
            <div className="settings-card__icon">
              <Shield size={20} />
            </div>
            <h3 className="settings-card__title">Security</h3>
            <p className="settings-card__desc">
              Audit log, session management, and security policies.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
