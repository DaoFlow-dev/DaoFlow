import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
  eyebrow?: string;
  footer?: ReactNode;
  "data-testid"?: string;
}

export function EmptyState({
  action,
  description,
  footer,
  icon,
  title,
  eyebrow,
  "data-testid": dataTestId
}: EmptyStateProps) {
  return (
    <Card className="border-dashed shadow-sm" data-testid={dataTestId}>
      <CardContent className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5">
          {icon}
        </div>

        <div className="space-y-2">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/70">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>

        {footer ? <div className="w-full max-w-2xl">{footer}</div> : null}
        {action ? (
          <div className="flex flex-wrap items-center justify-center gap-3">{action}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
