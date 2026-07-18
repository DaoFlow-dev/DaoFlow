/** Shell-escape a value for safe inclusion in SSH commands. */
export function shellQuote(value: string): string {
  if (value.length > 4096) {
    throw new Error("Input too long for shell argument");
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
