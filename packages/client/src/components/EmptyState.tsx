interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon = "📭", action }: EmptyStateProps) {
  return (
    <div className="df-empty-state">
      <span className="df-empty-state__icon">{icon}</span>
      <h3 className="df-empty-state__title">{title}</h3>
      {description && <p className="df-empty-state__desc">{description}</p>}
      {action && <div className="df-empty-state__action">{action}</div>}
    </div>
  );
}
