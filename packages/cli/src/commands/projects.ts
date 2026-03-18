import { Command } from "commander";
import { resolveCommandJsonOption } from "../command-helpers";
import { createClient } from "../trpc-client";

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("List and manage projects");

  cmd
    .command("list")
    .alias("ls")
    .option("--json", "Output as JSON")
    .description("List all projects")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const projects = await trpc.projects.query({ limit: 50 });

        if (isJson) {
          console.log(JSON.stringify({ ok: true, data: projects }));
          return;
        }

        if (!Array.isArray(projects) || projects.length === 0) {
          console.log("No projects found. Create one with the web dashboard.");
          return;
        }

        console.log("\n📁 Projects\n");
        for (const p of projects) {
          console.log(`  • ${p.name}  (${p.id})`);
        }
        console.log("");
      } catch (err) {
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              code: "API_ERROR"
            })
          );
        } else {
          console.error(
            "Error fetching projects:",
            err instanceof Error ? err.message : String(err)
          );
        }
        process.exit(1);
      }
    });

  return cmd;
}
