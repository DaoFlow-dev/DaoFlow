import type { ReactNode, HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "glass" | "outline";
  padding?: "none" | "sm" | "md" | "lg";
  hoverable?: boolean;
}

export function Card({
  children,
  variant = "default",
  padding = "md",
  hoverable = false,
  className = "",
  ...rest
}: CardProps) {
  const base = "df-card";
  const cls = [
    base,
    `df-card--${variant}`,
    `df-card--pad-${padding}`,
    hoverable ? "df-card--hoverable" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardHeader({ children, className = "", ...rest }: CardHeaderProps) {
  return (
    <div className={`df-card__header ${className}`} {...rest}>
      {children}
    </div>
  );
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardBody({ children, className = "", ...rest }: CardBodyProps) {
  return (
    <div className={`df-card__body ${className}`} {...rest}>
      {children}
    </div>
  );
}
