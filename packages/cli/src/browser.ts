import { spawnSync } from "node:child_process";

function browserCommands(url: string): string[][] {
  switch (process.platform) {
    case "darwin":
      return [["open", url]];
    case "win32":
      return [["rundll32", "url.dll,FileProtocolHandler", url]];
    default:
      return [
        ["xdg-open", url],
        ["gio", "open", url],
        ["gnome-open", url]
      ];
  }
}

export function tryOpenBrowser(url: string): boolean {
  for (const [command, ...args] of browserCommands(url)) {
    try {
      const result = spawnSync(command, args, { stdio: "ignore" });
      if (result.status === 0) {
        return true;
      }
    } catch {
      // Try the next browser opener.
    }
  }

  return false;
}
