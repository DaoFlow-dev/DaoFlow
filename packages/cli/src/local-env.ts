import { existsSync, readFileSync, writeFileSync } from "node:fs";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function upsertEnvFileValue(filePath: string, key: string, value: string): void {
  if (key.includes("=") || key.includes("\n") || key.includes("\r")) {
    throw new Error(`Invalid environment variable key: ${key}`);
  }

  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Invalid environment variable value for ${key}`);
  }

  const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}=`);
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (!replaced && keyPattern.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }

    return line;
  });

  if (!replaced) {
    while (updatedLines.length > 0 && updatedLines.at(-1) === "") {
      updatedLines.pop();
    }
    updatedLines.push(`${key}=${value}`);
  }

  writeFileSync(filePath, `${updatedLines.join("\n").replace(/\n*$/, "")}\n`);
}
