interface StatusCardProps {
  title: string;
  items: readonly string[];
}

export function StatusCard({ title, items }: StatusCardProps) {
  return (
    <section className="status-card">
      <div className="status-card__eyebrow">Foundation slice</div>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
