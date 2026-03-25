import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SetupStepIndicator } from "@/components/SetupStepIndicator";

interface SetupWizardStepLayoutProps {
  badge?: string;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  stepItems?: Array<{
    label: string;
    completed: boolean;
    active: boolean;
  }>;
  className?: string;
  contentClassName?: string;
  testId?: string;
}

export function SetupWizardStepLayout({
  badge,
  title,
  description,
  children,
  stepItems,
  className = "max-w-lg",
  contentClassName,
  testId
}: SetupWizardStepLayoutProps) {
  return (
    <main className="shell flex min-h-[60vh] items-center justify-center">
      <Card className={`w-full ${className}`} data-testid={testId}>
        <CardHeader>
          {stepItems && stepItems.length > 0 ? <SetupStepIndicator steps={stepItems} /> : null}
          {badge ? (
            <Badge variant="outline" className="w-fit">
              {badge}
            </Badge>
          ) : null}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
      </Card>
    </main>
  );
}
