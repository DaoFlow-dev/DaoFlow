export function RouteFallback() {
  return (
    <main className="shell flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-10 w-10 animate-pulse rounded-full border border-border bg-muted" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Loading view</p>
          <p className="text-sm text-muted-foreground">Preparing the next DaoFlow surface.</p>
        </div>
      </div>
    </main>
  );
}
