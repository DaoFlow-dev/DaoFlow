import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

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
  statusTone: string;
  statusLabel: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Environment management
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Encrypted environment configuration
        </h2>
      </div>

      {session.data && canManageEnvironmentVariables && infrastructureInventory.data ? (
        <form
          className="space-y-4"
          onSubmit={(event) => void handleUpsertEnvironmentVariable(event)}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Redacted read model
            </p>
            <h3 className="text-base font-semibold text-foreground">Save scoped variable</h3>
            <p className="mt-2 text-sm text-muted-foreground">
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
          <Button disabled={upsertEnvironmentVariable.isPending} type="submit">
            {upsertEnvironmentVariable.isPending ? "Saving..." : "Save variable"}
          </Button>
          {environmentVariableFeedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="environment-variable-feedback"
            >
              {environmentVariableFeedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Deploy-capable roles can update encrypted environment variables here.
        </p>
      ) : null}

      {session.data && environmentVariables.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="environment-variable-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Variables
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {environmentVariables.data.summary.totalVariables}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Secrets
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {environmentVariables.data.summary.secretVariables}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Runtime
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {environmentVariables.data.summary.runtimeVariables}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Build
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {environmentVariables.data.summary.buildVariables}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {environmentVariables.data.variables.map((variable) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`environment-variable-card-${variable.id}`}
                key={variable.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {variable.projectName} / {variable.environmentName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{variable.key}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(variable.statusTone)}>
                    {variable.statusLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Value: {variable.displayValue}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Category: {variable.category} · Source: {variable.source}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Branch pattern: {variable.branchPattern ?? "all branches"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Updated by {variable.updatedByEmail}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {environmentVariablesMessage ??
            "Sign in to inspect encrypted environment variable metadata."}
        </p>
      )}
    </section>
  );
}
