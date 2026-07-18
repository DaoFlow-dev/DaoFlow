export function redactActivitySecretValue(text: string, secret: string | undefined): string {
  return secret ? text.replaceAll(secret, "[redacted]") : text;
}
