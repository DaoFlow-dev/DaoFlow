interface BadgeProps {
  children: React.ReactNode;
  variant?: "healthy" | "running" | "queued" | "failed" | "inactive" | "default";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({ children, variant = "default", size = "sm", className = "" }: BadgeProps) {
  const cls = ["df-badge", `df-badge--${variant}`, `df-badge--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <span className={cls}>{children}</span>;
}
