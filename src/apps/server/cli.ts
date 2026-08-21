#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Deferred, Effect } from "effect";
import type { EnvironmentServerOptions } from "#server/features/environment-server/server/environment-server.contract";
import { startEnvironmentServer } from "#server/features/environment-server/server/start-environment-server";

const usage = "Usage: rebase serve [--port <1-65535>]";

export function runCli(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    return writeOutput(usage).pipe(Effect.as(0));
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

function parseServeArguments(arguments_: string[]): EnvironmentServerOptions {
  const [command, ...options] = arguments_;
  if (command !== "serve") throw new Error(usage);

  if (options.length === 0) return {};
  if (options.length !== 2 || options[0] !== "--port" || !options[1]) {
    throw new Error(usage);
  }

  const port = Number(options[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Port must be an integer between 1 and 65535. Found "${options[1]}".`,
    );
  }

  return { port };
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

const entryPoint = process.argv[1];
if (
  entryPoint &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint)
) {
  process.exitCode = await Effect.runPromise(runCli());
}
