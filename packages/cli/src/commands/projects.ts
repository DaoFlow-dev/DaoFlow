import { Command } from "commander";
import { ApiClient } from "../api-client";

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("List and manage projects");

  cmd
    .command("list")
    .alias("ls")
    .option("--json", "Output as JSON")
    .description("List all projects")
    .action(async (opts) => {
      try {
        const api = new ApiClient();
        const projects = await api.get<unknown[]>(
          "/trpc/projects?input=" + encodeURIComponent(JSON.stringify({ limit: 50 }))
        );

        if (opts.json) {
          console.log(JSON.stringify(projects, null, 2));
          return;
        }

        if (!Array.isArray(projects) || projects.length === 0) {
          console.log("No projects found. Create one with the web dashboard.");
          return;
        }

        console.log("\n📁 Projects\n");
        for (const p of projects) {
          const proj = p as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          console.log(`  • ${String(proj.name ?? "Unnamed")}  (${String(proj.id ?? "")})`);
        }
        console.log("");
      } catch (err) {
        console.error("Error fetching projects:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
