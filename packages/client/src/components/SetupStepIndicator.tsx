/**
 * SetupStepIndicator — shows progress through multi-step flows (setup wizard, onboarding).
 * Reusable across any multi-step form.
 */

interface Step {
  label: string;
  completed: boolean;
  active: boolean;
}

interface SetupStepIndicatorProps {
  steps: Step[];
}

export function SetupStepIndicator({ steps }: SetupStepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                step.completed
                  ? "bg-primary text-primary-foreground"
                  : step.active
                    ? "border-2 border-primary text-primary"
                    : "border border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {step.completed ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs ${
                step.active ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-8 ${step.completed ? "bg-primary" : "bg-muted-foreground/30"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
