export function AuthFieldError({
  id,
  message,
  testId
}: {
  id: string;
  message?: string;
  testId: string;
}) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} className="text-sm text-destructive" data-testid={testId}>
      {message}
    </p>
  );
}
