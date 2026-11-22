#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, release } from "node:os";

import { fileURLToPath } from "node:url";
import { environmentProtocol } from "#contracts/environment-connection/environment-rpc.contract.ts";
import { resolveHostAddress } from "#server/app/server/host-address.ts";
import {
  type EnvironmentServerOptions,
  startEnvironmentServer,
} from "#server/app/server/start-environment-server.ts";
import { errorMessage } from "#server/error-inspection.ts";

declare const REBASE_PRODUCT_VERSION: string;

const curlCouldNotConnect = 7;
const windowsReachDeadlineMilliseconds = 10_000;

const usage =
  "Usage: rebase [serve] [--host <ip-address|lan|tailscale>] [--port <1-65535>]";

export async function runCli(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (arguments_.includes("--version") || arguments_.includes("-v")) {
    process.stdout.write(`${versionOutput()}\n`);
    return 0;
  }

  try {
    await serve(parseServeArguments(arguments_));
    return 0;
  } catch (error) {
    process.stderr.write(`rebase serve failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

export async function main() {
  process.exitCode = await runCli();
}

function parseServeArguments(arguments_: string[]): EnvironmentServerOptions {
  const normalizedArguments =
    arguments_.length === 0 || arguments_[0]?.startsWith("--")
      ? ["serve", ...arguments_]
      : arguments_;
  const [command, ...options] = normalizedArguments;
  if (command !== "serve") throw new Error(usage);

  const serveOptions: { host?: string; port?: number } = {};
  for (let index = 0; index < options.length; index += 2) {
    const flag = options[index];
    const value = options[index + 1];
    if (!value) throw new Error(usage);
    if (flag === "--port") serveOptions.port = parsePort(value);
    else if (flag === "--host") serveOptions.host = resolveHostAddress(value);
    else throw new Error(usage);
  }

  return {
    browserAssetsRoot: resolveBrowserAssetsRoot(),
    home: homedir(),
    ...serveOptions,
  };
}

function parsePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Port must be an integer between 1 and 65535. Found "${value}".`,
    );
  }
  return port;
}

async function serve(options: EnvironmentServerOptions) {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const server = await startEnvironmentServer(options);
    try {
      if (shutdown.signal.aborted) return;
      const origin =
        options.host === undefined
          ? `http://localhost:${server.port}`
          : server.origin;
      const pairingUrl = server.pairingUrl.replace(server.origin, origin);
      process.stdout.write(`Listening URL: ${origin}\n`);
      process.stdout.write(`Pairing URL: ${pairingUrl}\n`);
      void openDefaultBrowser(pairingUrl, shutdown.signal);
      await aborted(shutdown.signal);
    } finally {
      await server.close();
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function aborted(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function resolveBrowserAssetsRoot() {
  const candidates = [
    new URL("./web", import.meta.url),
    new URL("../web/dist/web", import.meta.url),
  ];
  const root = candidates.find((candidate) => existsSync(candidate));
  if (root === undefined) {
    throw new Error(
      "Browser assets are missing. Reinstall Rebase or rebuild the web client.",
    );
  }
  return fileURLToPath(root);
}

function productVersion() {
  if (typeof REBASE_PRODUCT_VERSION === "string") return REBASE_PRODUCT_VERSION;
  const packageMetadata = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { readonly version: string };
  return packageMetadata.version;
}

function versionOutput() {
  return [
    `Rebase ${productVersion()}`,
    `Environment protocol ${environmentProtocol}`,
  ].join("\n");
}

const entryPoint = process.argv[1];
if (
  entryPoint &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint)
) {
  await main();
}

async function openDefaultBrowser(url: string, shutdown: AbortSignal) {
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
