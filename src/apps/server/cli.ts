#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { environmentProtocol } from "#contracts/environment-connection/environment-rpc.contract.ts";
import { productVersion } from "#server/app/runtime/product-version.ts";
import { resolveHostAddress } from "#server/app/server/host-address.ts";
import { startEnvironmentServer } from "#server/app/server/serve-environment.ts";
import {
  browserOrigin,
  findRunningServer,
  openServer,
  type ServerReady,
  serverLogPath,
  stopServer,
} from "#server/cli/background-server.ts";
import { openDefaultBrowser } from "#server/cli/default-browser.ts";
import { updateInstallation } from "#server/cli/self-update.ts";
import { errorMessage } from "#server/error-inspection.ts";

const usage = `Usage: rebase [command] [options]

Commands:
  open      Start the server in the background if needed and open the browser (default)
  serve     Run the server in the foreground
              --host <ip-address|lan|tailscale>
              --port <1-65535>
  stop      Stop the background server
  status    Show the background server; exits 1 when it is not running
  update    Update an install made with install.sh or install.ps1
              --version <version>

Environment:
  BROWSER=none               Print the pairing URL without opening a browser
  REBASE_RELEASE_BASE_URL    Download releases from this mirror instead of GitHub`;

export async function runCli(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (arguments_[0] === "--version" || arguments_[0] === "-v") {
    process.stdout.write(`${versionOutput()}\n`);
    return 0;
  }

  const [command = "open", ...options] = arguments_;
  try {
    return await runCommand(command, options);
  } catch (error) {
    process.stderr.write(`rebase ${command} failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

export async function main() {
  process.exitCode = await runCli();
}

async function runCommand(command: string, options: string[]) {
  const home = homedir();
  switch (command) {
    case "open":
      parseOptions(options, {});
      await open(home);
      return 0;
    case "serve":
      await serve(home, options);
      return 0;
    case "stop":
      parseOptions(options, {});
      return stop(home);
    case "status":
      parseOptions(options, {});
      return status(home);
    case "update": {
      const { version } = parseOptions(options, { version: String });
      await updateInstallation(home, productVersion(), version);
      return 0;
    }
    default:
      throw new Error(usage);
  }
}

function parseOptions<
  Parsers extends Record<string, (value: string) => unknown>,
>(options: string[], parsers: Parsers) {
  const parsed: { [Name in keyof Parsers]?: ReturnType<Parsers[Name]> } = {};
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index]?.replace(/^--/, "") ?? "";
    const value = options[index + 1];
    const parser = Object.hasOwn(parsers, name) ? parsers[name] : undefined;
    if (!options[index]?.startsWith("--") || !parser || !value)
      throw new Error(usage);
    parsed[name as keyof Parsers] = parser(value) as ReturnType<
      Parsers[keyof Parsers]
    >;
  }
  return parsed;
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

async function open(home: string) {
  const ready = await openServer(home);
  writeReady(ready);
  await openDefaultBrowser(ready.pairingUrl, new AbortController().signal);
}

async function serve(home: string, options: string[]) {
  const { host, port } = parseOptions(options, {
    host: resolveHostAddress,
    port: parsePort,
  });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const server = await startEnvironmentServer({
      browserAssetsRoot: resolveBrowserAssetsRoot(),
      home,
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      requestShutdown: stop,
    });
    try {
      if (shutdown.signal.aborted) return;
      const origin =
        host === undefined ? `http://localhost:${server.port}` : server.origin;
      const ready: ServerReady = {
        origin,
        pairingUrl: server.pairingUrl.replace(server.origin, origin),
      };
      writeReady(ready);
      process.send?.(ready);
      void openDefaultBrowser(ready.pairingUrl, shutdown.signal);
      await aborted(shutdown.signal);
    } finally {
      await server.close();
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function stop(home: string) {
  const stopped = await stopServer(home);
  switch (stopped.state) {
    case "not-running":
      process.stdout.write("Rebase is not running.\n");
      return 0;
    case "stopped":
      process.stdout.write(`Stopped Rebase (PID ${stopped.marker.pid}).\n`);
      return 0;
    case "desktop":
      process.stdout.write(
        `The Rebase desktop app is running the server (PID ${stopped.marker.pid}). Quit the desktop app to stop it.\n`,
      );
      return 1;
  }
}

async function status(home: string) {
  const running = await findRunningServer(home);
  if (running === undefined) {
    process.stdout.write("Rebase is not running.\n");
    return 1;
  }
  process.stdout.write(
    [
      `Rebase ${running.version} is running.`,
      `URL: ${browserOrigin(running)}`,
      `PID: ${running.pid}`,
      `Log: ${serverLogPath(home)}`,
      "",
    ].join("\n"),
  );
  return 0;
}

function writeReady(ready: ServerReady) {
  process.stdout.write(`Listening URL: ${ready.origin}\n`);
  process.stdout.write(`Pairing URL: ${ready.pairingUrl}\n`);
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
