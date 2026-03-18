import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";

interface EnvironmentEntry {
  id: string;
  projectName: string;
  name: string;
}

interface EnvironmentVariable {
  id: string;
  projectName: string;
  environmentName: string;
  key: string;
  displayValue: string;
  isSecret: boolean;
  category: string;
  source: string;
  branchPattern: string | null;
  statusTone?: string;
  statusLabel?: string;
  updatedByEmail: string;
}

interface EnvironmentVariablesData {
  summary: {
    totalVariables: number;
    secretVariables: number;
    runtimeVariables: number;
    buildVariables: number;
  };
  variables: EnvironmentVariable[];
}

export interface EnvironmentVariablesProps {
  session: { data: unknown };
  environmentVariables: { data?: EnvironmentVariablesData };
  environmentVariablesMessage: string | null;
  canManageEnvironmentVariables: boolean;
  infrastructureInventory: { data?: { environments: EnvironmentEntry[] } };
  refreshOperationalViews: () => Promise<void>;
}

export function EnvironmentVariables({
  session,
  environmentVariables,
  environmentVariablesMessage,
  canManageEnvironmentVariables,
  infrastructureInventory,
  refreshOperationalViews
}: EnvironmentVariablesProps) {
  const [environmentVariableEnvironmentId, setEnvironmentVariableEnvironmentId] =
    useState("env_daoflow_staging");
  const [environmentVariableKey, setEnvironmentVariableKey] = useState("NEXT_PUBLIC_SUPPORT_EMAIL");
  const [environmentVariableValue, setEnvironmentVariableValue] = useState("ops@daoflow.local");
  const [environmentVariableCategory, setEnvironmentVariableCategory] = useState<
    "runtime" | "build"
  >("runtime");
  const [environmentVariableBranchPattern, setEnvironmentVariableBranchPattern] = useState("");
  const [environmentVariableIsSecret, setEnvironmentVariableIsSecret] = useState(false);
  const [environmentVariableFeedback, setEnvironmentVariableFeedback] = useState<string | null>(
    null
  );
  const upsertEnvironmentVariable = trpc.upsertEnvironmentVariable.useMutation();

  async function handleUpsertEnvironmentVariable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnvironmentVariableFeedback(null);

    try {
      const variable = await upsertEnvironmentVariable.mutateAsync({
        environmentId: environmentVariableEnvironmentId,
        key: environmentVariableKey,
        value: environmentVariableValue,
        isSecret: environmentVariableIsSecret,
        category: environmentVariableCategory,
        branchPattern: environmentVariableBranchPattern || undefined
      });
      await refreshOperationalViews();
      setEnvironmentVariableFeedback(
        `Saved ${variable.key} for ${variable.environmentName} (${variable.category}).`
      );
    } catch (error) {
      setEnvironmentVariableFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to save the environment variable right now."
      );
    }
  }

  return (
    <section className="environment-variables">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Environment management</p>
        <h2>Encrypted environment configuration</h2>
      </div>

      {session.data && canManageEnvironmentVariables && infrastructureInventory.data ? (
        <form
          className="environment-variable-composer"
          onSubmit={(event) => void handleUpsertEnvironmentVariable(event)}
        >
          <div>
            <p className="roadmap-item__lane">Redacted read model</p>
            <h3>Save scoped variable</h3>
            <p className="deployment-card__meta">
              Secret values stay write-only in the UI and are redacted on every read path.
            </p>
          </div>
          <label>
            Environment
            <select
              value={environmentVariableEnvironmentId}
              onChange={(event) => setEnvironmentVariableEnvironmentId(event.target.value)}
            >
              {infrastructureInventory.data.environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.projectName} / {environment.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Key
            <input
              value={environmentVariableKey}
              onChange={(event) => setEnvironmentVariableKey(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Value
            <input
              value={environmentVariableValue}
              onChange={(event) => setEnvironmentVariableValue(event.target.value)}
            />
          </label>
          <label>
            Category
            <select
              value={environmentVariableCategory}
              onChange={(event) =>
                setEnvironmentVariableCategory(event.target.value as "runtime" | "build")
              }
            >
              <option value="runtime">runtime</option>
              <option value="build">build</option>
            </select>
          </label>
          <label>
            Branch pattern
            <input
              value={environmentVariableBranchPattern}
              onChange={(event) => setEnvironmentVariableBranchPattern(event.target.value)}
              placeholder="optional, e.g. preview/*"
            />
          </label>
          <label className="checkbox-label">
            <input
              checked={environmentVariableIsSecret}
              onChange={(event) => setEnvironmentVariableIsSecret(event.target.checked)}
              type="checkbox"
            />
            Secret value
          </label>
          <button
            className="action-button"
            disabled={upsertEnvironmentVariable.isPending}
            type="submit"
          >
            {upsertEnvironmentVariable.isPending ? "Saving..." : "Save variable"}
          </button>
          {environmentVariableFeedback ? (
            <p className="auth-feedback" data-testid="environment-variable-feedback">
              {environmentVariableFeedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="viewer-empty">
          Deploy-capable roles can update encrypted environment variables here.
        </p>
      ) : null}

      {session.data && environmentVariables.data ? (
        <>
          <div className="environment-variable-summary" data-testid="environment-variable-summary">
            <div className="token-summary__item">
              <span className="metric__label">Variables</span>
              <strong>{environmentVariables.data.summary.totalVariables}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Secrets</span>
              <strong>{environmentVariables.data.summary.secretVariables}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Runtime</span>
              <strong>{environmentVariables.data.summary.runtimeVariables}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Build</span>
              <strong>{environmentVariables.data.summary.buildVariables}</strong>
            </div>
          </div>

          <div className="environment-variable-list">
            {environmentVariables.data.variables.map((variable) => {
              const statusTone = variable.statusTone ?? (variable.isSecret ? "failed" : "queued");
              const statusLabel =
                variable.statusLabel ?? (variable.isSecret ? "Secret" : variable.category);

              return (
                <article
                  className="token-card"
                  data-testid={`environment-variable-card-${variable.id}`}
                  key={variable.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {variable.projectName} / {variable.environmentName}
                      </p>
                      <h3>{variable.key}</h3>
                    </div>
                    <span className={`deployment-status deployment-status--${statusTone}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="deployment-card__meta">Value: {variable.displayValue}</p>
                  <p className="deployment-card__meta">
                    Category: {variable.category} · Source: {variable.source}
                  </p>
                  <p className="deployment-card__meta">
                    Branch pattern: {variable.branchPattern ?? "all branches"}
                  </p>
                  <p className="deployment-card__meta">Updated by {variable.updatedByEmail}</p>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {environmentVariablesMessage ??
            "Sign in to inspect encrypted environment variable metadata."}
        </p>
      )}
    </section>
  );
}
