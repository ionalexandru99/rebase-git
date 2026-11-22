import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { release } from "node:os";

const curlCouldNotConnect = 7;
const windowsReachDeadlineMilliseconds = 10_000;

export async function openDefaultBrowser(url: string, shutdown: AbortSignal) {
  if (process.env.BROWSER === "none") return;
  if (process.platform === "darwin") return launchBrowser("open", [url]);
  if (process.platform === "win32") {
    return launchBrowser("cmd.exe", windowsStartArguments(url));
  }
  if (isWindowsSubsystemForLinux()) {
    await untilWindowsReaches(url, shutdown);
    if (shutdown.aborted) return;
    return launchBrowser("cmd.exe", windowsStartArguments(url));
  }
  return launchBrowser("xdg-open", [url]);
}

function launchBrowser(command: string, arguments_: readonly string[]) {
  try {
    const child = spawn(command, arguments_, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => undefined);
    child.unref();
  } catch {}
}

function windowsStartArguments(url: string) {
  return ["/d", "/s", "/c", "start", "", url];
}

async function untilWindowsReaches(url: string, shutdown: AbortSignal) {
  const signal = AbortSignal.any([
    shutdown,
    AbortSignal.timeout(windowsReachDeadlineMilliseconds),
  ]);
  while (!signal.aborted && !(await windowsReaches(url, signal))) {}
}

function windowsReaches(url: string, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    execFile(
      "curl.exe",
      ["--silent", "--output", "NUL", new URL(url).origin],
      { signal, windowsHide: true },
      (error) => resolve(error?.code !== curlCouldNotConnect),
    );
  });
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
