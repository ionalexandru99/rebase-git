import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { release } from "node:os";

export function openDefaultBrowser(url: string) {
  if (process.env.BROWSER === "none") {
    return;
  }

  try {
    const invocation = browserInvocation(url);
    const child = spawn(invocation.command, invocation.arguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => undefined);
    child.unref();
  } catch {}
}

function browserInvocation(url: string): BrowserInvocation {
  if (process.platform === "darwin") {
    return { arguments: [url], command: "open" };
  }
  if (process.platform === "win32" || isWindowsSubsystemForLinux()) {
    return {
      arguments: ["/d", "/s", "/c", "start", "", url],
      command: "cmd.exe",
    };
  }
  return { arguments: [url], command: "xdg-open" };
}

function isWindowsSubsystemForLinux() {
  if (process.env.WSL_DISTRO_NAME !== undefined) return true;
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8")
      .toLowerCase()
      .includes("microsoft");
  } catch {
    return release().toLowerCase().includes("microsoft");
  }
}

interface BrowserInvocation {
  readonly arguments: readonly string[];
  readonly command: string;
}
