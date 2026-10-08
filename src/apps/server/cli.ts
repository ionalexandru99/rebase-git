#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, release } from "node:os";

import { fileURLToPath } from "node:url";
import { Deferred, Effect } from "effect";
import { environmentProtocol } from "#contracts/environment-connection/environment-rpc.contract.ts";
import { resolveHostAddress } from "#server/app/server/host-address.ts";
import {
  type EnvironmentServerOptions,
  startEnvironmentServer,
} from "#server/app/server/start-environment-server.ts";

declare const REBASE_PRODUCT_VERSION: string;

const curlCouldNotConnect = 7;
const windowsReachDeadline = "10 seconds";

const usage =
  "Usage: rebase [serve] [--host <ip-address|lan|tailscale>] [--port <1-65535>]";

export function runCli(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    return writeOutput(usage).pipe(Effect.as(0));
  }
  if (arguments_.includes("--version") || arguments_.includes("-v")) {
    return writeOutput(versionOutput()).pipe(Effect.as(0));
  }

  const program = Effect.try({
    try: () => parseServeArguments(arguments_),
    catch: normalizeError,
  }).pipe(Effect.flatMap(serve));

  return Effect.matchEffect(program, {
    onFailure: (error) =>
      writeFailure(`rebase serve failed: ${error.message}`).pipe(Effect.as(1)),
    onSuccess: () => Effect.succeed(0),
  });
}

export async function main() {
  process.exitCode = await Effect.runPromise(runCli());
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

function serve(options: EnvironmentServerOptions) {
  return Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* acquireShutdownSignal();
      const server = yield* Effect.raceFirst(
        startEnvironmentServer(options),
        Deferred.await(shutdown),
      );
      if (server === undefined) return;

      const origin =
        options.host === undefined
          ? `http://localhost:${server.port}`
          : server.origin;
      const pairingUrl = server.pairingUrl.replace(server.origin, origin);
      yield* Effect.sync(() => {
        process.stdout.write(`Listening URL: ${origin}\n`);
        process.stdout.write(`Pairing URL: ${pairingUrl}\n`);
      });
      yield* Effect.forkScoped(openDefaultBrowser(pairingUrl));
      yield* Deferred.await(shutdown);
    }),
  );
}

function acquireShutdownSignal() {
  return Effect.gen(function* () {
    const shutdown = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stop = () => {
          Deferred.doneUnsafe(shutdown, Effect.void);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        return stop;
      }),
      (stop) =>
        Effect.sync(() => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
        }),
    );
    return shutdown;
  });
}

function writeOutput(line: string) {
  return Effect.sync(() => {
    process.stdout.write(`${line}\n`);
  });
}

function writeFailure(line: string) {
  return Effect.sync(() => {
    process.stderr.write(`${line}\n`);
  });
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
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

function openDefaultBrowser(url: string) {
  if (process.env.BROWSER === "none") return Effect.void;
  if (process.platform === "darwin") return launchBrowser("open", [url]);
  if (process.platform === "win32") {
    return launchBrowser("cmd.exe", windowsStartArguments(url));
  }
  if (isWindowsSubsystemForLinux()) {
    return untilWindowsReaches(url).pipe(
      Effect.andThen(launchBrowser("cmd.exe", windowsStartArguments(url))),
    );
  }
  return launchBrowser("xdg-open", [url]);
}

function launchBrowser(command: string, arguments_: readonly string[]) {
  return Effect.sync(() => {
    try {
      const child = spawn(command, arguments_, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => undefined);
      child.unref();
    } catch {}
  });
}

function windowsStartArguments(url: string) {
  return ["/d", "/s", "/c", "start", "", url];
}

function untilWindowsReaches(url: string) {
  return Effect.callback<void, "Unreachable">((resume) => {
    const probe = execFile(
      "curl.exe",
      ["--silent", "--output", "NUL", new URL(url).origin],
      { windowsHide: true },
      (error) => {
        resume(
          error?.code === curlCouldNotConnect
            ? Effect.fail("Unreachable")
            : Effect.void,
        );
      },
    );
    return Effect.sync(() => probe.kill());
  }).pipe(
    Effect.eventually,
    Effect.timeout(windowsReachDeadline),
    Effect.ignore,
  );
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
