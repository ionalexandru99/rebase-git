#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { currentEnvironmentProtocol } from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { openDefaultBrowser } from "#server/features/browser-client/default-browser";
import type { EnvironmentServerOptions } from "#server/features/environment-server/server/environment-server.contract";
import { resolveHostAddress } from "#server/features/environment-server/server/host-address";
import { startEnvironmentServer } from "#server/features/environment-server/server/start-environment-server";
import { productVersion } from "#server/product-version";

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

  return { browserAssetsRoot: resolveBrowserAssetsRoot(), ...serveOptions };
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

      yield* Effect.sync(() => {
        process.stdout.write(`Listening URL: ${server.origin}\n`);
        process.stdout.write(`Pairing URL: ${server.pairingUrl}\n`);
        openDefaultBrowser(server.pairingUrl);
      });
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
    new URL("../../web/dist/web", import.meta.url),
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
  const protocol = currentEnvironmentProtocol;
  return [
    `Rebase ${productVersion}`,
    `Environment protocol ${protocol.major}.${protocol.minor} (minimum ${protocol.major}.${protocol.minimumSupportedMinor})`,
  ].join("\n");
}

const entryPoint = process.argv[1];
if (
  entryPoint &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint)
) {
  await main();
}
