import { Command } from "commander";
import { createHash } from "crypto";
import { renameSync, unlinkSync, existsSync } from "fs";
import chalk from "chalk";
import ora from "ora";
import { resolveCommandJsonOption, getErrorMessage } from "../command-helpers";
import { CLI_VERSION } from "../version";

const GH_REPO = "DaoFlow-dev/DaoFlow";
const GH_API_RELEASES = `https://api.github.com/repos/${GH_REPO}/releases`;

interface GHAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GHRelease {
  tag_name: string;
  assets: GHAsset[];
  html_url: string;
}

interface UpdateOptions {
  version?: string;
  yes?: boolean;
  json?: boolean;
}

/**
 * Detect the expected binary asset name for the current platform and arch.
 *   daoflow-darwin-arm64, daoflow-darwin-x64, daoflow-linux-arm64, daoflow-linux-x64
 */
function detectAssetName(): string | null {
  const platform = process.platform; // darwin | linux
  if (platform !== "darwin" && platform !== "linux") return null;

  const arch = process.arch; // arm64 | x64
  const normalizedArch = arch === "arm64" ? "arm64" : "x64";
  return `daoflow-${platform}-${normalizedArch}`;
}

/**
 * Determine if the process is running from a compiled binary (not `bun run dev`).
 */
function isCompiledBinary(): boolean {
  const execPath = process.execPath;
  // Compiled binaries are standalone; dev mode runs through bun/node
  return !execPath.includes("bun") && !execPath.includes("node") && !execPath.includes("deno");
}

async function fetchRelease(tag?: string): Promise<GHRelease> {
  const url =
    tag && tag !== "latest" ? `${GH_API_RELEASES}/tags/${tag}` : `${GH_API_RELEASES}/latest`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "daoflow-cli" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as GHRelease;
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": "daoflow-cli" },
    signal: AbortSignal.timeout(120_000) // 2 min for large binaries
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function parseChecksums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 2) {
      // Format: <sha256>  <filename>
      map.set(parts[1], parts[0]);
    }
  }
  return map;
}

function stripTagPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function updateCommand(): Command {
  return new Command("update")
    .description("Self-update the DaoFlow CLI binary from the latest GitHub release")
    .option("--version <tag>", "Target release tag (e.g. v0.3.5), default: latest")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: UpdateOptions, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      // -- Guard: dev mode --
      if (!isCompiledBinary()) {
        const msg =
          "Running in development mode (not a compiled binary). Use 'bun run build:cli' to create a compiled binary, then run update from it.";
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "DEV_MODE" }));
        } else {
          console.error(chalk.yellow(msg));
        }
        process.exit(0);
      }

      // -- Guard: platform --
      const assetName = detectAssetName();
      if (!assetName) {
        const msg = `Unsupported platform: ${process.platform}/${process.arch}`;
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "UNSUPPORTED_PLATFORM" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Fetch release --
      const fetchSpinner = !isJson ? ora("Checking for updates...").start() : null;
      let release: GHRelease;
      try {
        release = await fetchRelease(opts.version);
      } catch (error) {
        fetchSpinner?.fail("Failed to check for updates");
        const msg = getErrorMessage(error);
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "FETCH_FAILED" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      const remoteVersion = stripTagPrefix(release.tag_name);
      const localVersion = CLI_VERSION;

      // -- Already up to date --
      if (remoteVersion === localVersion && !opts.version) {
        fetchSpinner?.succeed(`Already up to date (v${localVersion})`);
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: true,
              currentVersion: localVersion,
              latestVersion: remoteVersion,
              updated: false
            })
          );
        }
        process.exit(0);
      }

      fetchSpinner?.succeed(`Found release v${remoteVersion}`);

      // -- Find asset --
      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) {
        const msg = `No binary found for ${assetName} in release ${release.tag_name}`;
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "ASSET_NOT_FOUND" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Confirm --
      if (!opts.yes && !isJson) {
        console.error();
        console.error(chalk.bold("  📦 DaoFlow CLI Update\n"));
        console.error(`  Current:  ${chalk.dim("v" + localVersion)}`);
        console.error(`  Target:   ${chalk.cyan("v" + remoteVersion)}`);
        console.error(`  Binary:   ${chalk.dim(process.execPath)}`);
        console.error(
          `  Asset:    ${chalk.dim(assetName)} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`
        );
        console.error();

        const rl = await import("readline");
        const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>((resolve) => {
          iface.question("Proceed? (y/N): ", (ans) => {
            iface.close();
            resolve(ans.trim());
          });
        });
        if (answer.toLowerCase() !== "y") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
      }

      // -- Download binary --
      const dlSpinner = !isJson
        ? ora(`Downloading ${assetName} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`).start()
        : null;
      let binaryBuf: Buffer;
      try {
        binaryBuf = await downloadToBuffer(asset.browser_download_url);
        dlSpinner?.succeed("Downloaded binary");
      } catch (error) {
        dlSpinner?.fail("Download failed");
        const msg = getErrorMessage(error);
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "DOWNLOAD_FAILED" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Verify checksum --
      const checksumAsset = release.assets.find((a) => a.name === "checksums.txt");
      if (checksumAsset) {
        const verifySpinner = !isJson ? ora("Verifying checksum...").start() : null;
        try {
          const checksumBuf = await downloadToBuffer(checksumAsset.browser_download_url);
          const checksums = parseChecksums(checksumBuf.toString("utf-8"));
          const expectedSha = checksums.get(assetName);
          if (expectedSha) {
            const actualSha = createHash("sha256").update(binaryBuf).digest("hex");
            if (actualSha !== expectedSha) {
              verifySpinner?.fail("Checksum mismatch");
              const msg = `SHA-256 mismatch: expected ${expectedSha}, got ${actualSha}`;
              if (isJson) {
                console.log(JSON.stringify({ ok: false, error: msg, code: "CHECKSUM_MISMATCH" }));
              } else {
                console.error(chalk.red(msg));
              }
              process.exit(1);
            }
            verifySpinner?.succeed("Checksum verified (SHA-256)");
          } else {
            verifySpinner?.warn("Checksum entry not found — skipping verification");
          }
        } catch (error) {
          verifySpinner?.warn(`Checksum verification skipped: ${getErrorMessage(error)}`);
        }
      }

      // -- Atomic replace --
      const binaryPath = process.execPath;
      const tmpPath = binaryPath + ".new";

      const installSpinner = !isJson ? ora("Installing update...").start() : null;
      try {
        // Write new binary to temp file
        const { writeFileSync } = await import("fs");
        writeFileSync(tmpPath, binaryBuf, { mode: 0o755 });

        // Atomic rename over old binary
        renameSync(tmpPath, binaryPath);
        installSpinner?.succeed("Binary replaced");
      } catch (error) {
        installSpinner?.fail("Failed to replace binary");
        // Clean up temp file if it exists
        try {
          if (existsSync(tmpPath)) unlinkSync(tmpPath);
        } catch {
          /* best effort */
        }

        const msg = getErrorMessage(error);
        const isPermission =
          error instanceof Error &&
          ("code" in error ? (error as NodeJS.ErrnoException).code === "EACCES" : false);
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: isPermission ? `Permission denied. Try: sudo daoflow update` : msg,
              code: "INSTALL_FAILED"
            })
          );
        } else {
          if (isPermission) {
            console.error(chalk.red(`Permission denied writing to ${binaryPath}`));
            console.error(chalk.dim(`  Try: sudo daoflow update --yes`));
          } else {
            console.error(chalk.red(msg));
          }
        }
        process.exit(1);
      }

      // -- Output --
      if (isJson) {
        console.log(
          JSON.stringify({
            ok: true,
            previousVersion: localVersion,
            newVersion: remoteVersion,
            binary: binaryPath,
            updated: true
          })
        );
      } else {
        console.error();
        console.error(chalk.green.bold("✅ DaoFlow CLI updated successfully!"));
        console.error(`  ${chalk.dim("v" + localVersion)} → ${chalk.cyan("v" + remoteVersion)}`);
        console.error();
      }

      process.exit(0);
    });
}
