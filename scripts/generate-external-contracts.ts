import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, Option } from "commander";
import {
  apiExamples,
  apiProcedureAccess,
  cliCommandMeta,
  cliExamples
} from "./external-contract-metadata";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiOutputPath = resolve(rootDir, "docs/static/contracts/api-contract.json");
const cliOutputPath = resolve(rootDir, "docs/static/contracts/cli-contract.json");
const checkMode = process.argv.includes("--check");

interface RouterProcedure {
  _def?: {
    inputs?: unknown[];
    type?: "query" | "mutation" | "subscription";
  };
}

interface CommandNode {
  path: string;
  description: string;
  aliases: string[];
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; description: string; required: boolean }>;
  hasAction: boolean;
  hasSubcommands: boolean;
}

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

async function importWithSuppressedAuthLog<T>(specifier: string): Promise<T> {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first.startsWith("[auth] Email transport: none configured")) {
      return;
    }
    originalLog(...args);
  };

  try {
    return (await import(specifier)) as T;
  } finally {
    console.log = originalLog;
  }
}

function getProcedureInputSchema(
  zodModule: { z: { toJSONSchema: (schema: unknown) => unknown } },
  procedure: RouterProcedure
): unknown | null {
  const [input] = procedure._def?.inputs ?? [];
  return input ? zodModule.z.toJSONSchema(input) : null;
}

function commandOption(option: Option) {
  return {
    flags: option.flags,
    description: option.description ?? "",
    required: option.mandatory ?? false
  };
}

function collectCommands(command: Command, prefix: string[] = []): CommandNode[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()].join(" ");
    const node: CommandNode = {
      path,
      description: child.description(),
      aliases: child.aliases(),
      arguments: child.registeredArguments.map((arg) => ({
        name: arg.name(),
        required: arg.required,
        variadic: arg.variadic
      })),
      options: child.options.map(commandOption),
      hasAction:
        typeof (child as Command & { _actionHandler?: unknown })._actionHandler === "function",
      hasSubcommands: child.commands.length > 0
    };

    return [node, ...collectCommands(child, [...prefix, child.name()])];
  });
}

async function writeOrCheck(path: string, value: unknown): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });

  if (!checkMode) {
    await Bun.write(path, next);
    return;
  }

  const current = await Bun.file(path)
    .text()
    .catch(() => "");
  let normalizedCurrent = current;
  try {
    normalizedCurrent = current ? `${JSON.stringify(JSON.parse(current), null, 2)}\n` : "";
  } catch {
    normalizedCurrent = current;
  }

  if (normalizedCurrent !== next) {
    throw new Error(`Generated contract is stale: ${path}`);
  }
}

async function buildApiContract() {
  const [{ appRouter }, zodModule] = await Promise.all([
    importWithSuppressedAuthLog<{
      appRouter: { _def: { procedures: Record<string, RouterProcedure> } };
    }>("../packages/server/src/router"),
    import("../packages/server/node_modules/zod/index.js")
  ]);

  const procedures = Object.entries(appRouter._def.procedures).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const actualNames = new Set(procedures.map(([name]) => name));
  const declaredNames = Object.keys(apiProcedureAccess).sort();
  const missing = procedures.map(([name]) => name).filter((name) => !(name in apiProcedureAccess));
  const extra = declaredNames.filter((name) => !actualNames.has(name));

  if (missing.length || extra.length) {
    throw new Error(
      [
        missing.length ? `Missing API access metadata: ${missing.join(", ")}` : "",
        extra.length ? `Unknown API access metadata: ${extra.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return {
    schemaVersion: 1,
    kind: "daoflow-api-contract",
    basePath: "/trpc",
    procedures: procedures.map(([name, procedure]) => {
      const access = apiProcedureAccess[name];
      const method = procedure._def?.type === "mutation" ? "POST" : "GET";
      return {
        name,
        summary: humanize(name),
        path: `/trpc/${name}`,
        method,
        lane: access.laneOverride ?? (method === "POST" ? "command" : "read"),
        auth: access.auth,
        requiredRoles: [...access.requiredRoles],
        requiredScopes: [...access.requiredScopes],
        inputSchema: getProcedureInputSchema(
          zodModule as { z: { toJSONSchema: (schema: unknown) => unknown } },
          procedure
        )
      };
    }),
    examples: apiExamples
  };
}

async function buildCliContract() {
  const { createProgram } = await import("../packages/cli/src/program");
  const program = createProgram();
  const commands = collectCommands(program).sort((a, b) => a.path.localeCompare(b.path));
  const actualPaths = new Set(commands.map((command) => command.path));
  const declaredPaths = Object.keys(cliCommandMeta).sort();
  const missing = commands
    .filter((command) => command.hasAction || !command.hasSubcommands)
    .map((command) => command.path)
    .filter(
      (path) =>
        !(path in cliCommandMeta) &&
        !commands.find((node) => node.path === path && !node.hasAction && node.hasSubcommands)
    );
  const extra = declaredPaths.filter((path) => !actualPaths.has(path));

  if (missing.length || extra.length) {
    throw new Error(
      [
        missing.length ? `Missing CLI command metadata: ${missing.join(", ")}` : "",
        extra.length ? `Unknown CLI command metadata: ${extra.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return {
    schemaVersion: 1,
    kind: "daoflow-cli-contract",
    binary: "daoflow",
    commands: commands.map((command) => {
      const meta = cliCommandMeta[command.path] ?? {
        lane: "local",
        requiredScopes: [],
        mutating: false
      };
      return {
        path: command.path,
        summary: command.description,
        lane: meta.lane,
        requiredScopes: [...meta.requiredScopes],
        mutating: meta.mutating,
        hasAction: command.hasAction,
        hasSubcommands: command.hasSubcommands,
        aliases: command.aliases,
        arguments: command.arguments,
        options: command.options,
        supportsJson: command.options.some((option) => option.flags.includes("--json")),
        supportsDryRun: command.options.some((option) => option.flags.includes("--dry-run")),
        supportsYes: command.options.some((option) => option.flags.includes("--yes"))
      };
    }),
    examples: cliExamples
  };
}

const [apiContract, cliContract] = await Promise.all([buildApiContract(), buildCliContract()]);

await Promise.all([
  writeOrCheck(apiOutputPath, apiContract),
  writeOrCheck(cliOutputPath, cliContract)
]);

if (!checkMode) {
  console.log(`Wrote ${apiOutputPath}`);
  console.log(`Wrote ${cliOutputPath}`);
} else {
  console.log("External contracts are up to date.");
}
