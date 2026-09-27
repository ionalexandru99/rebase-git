import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentPairingExchanged,
  environmentPairingExchangePath,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands";
import {
  acquireEnvironment,
  serveEnvironment,
} from "#server/app/server/serve-environment";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const repositoryPath = process.argv[2];
if (repositoryPath === undefined)
  throw new Error("Missing prepared corpus path");
const temporary = await mkdtemp(join(tmpdir(), "rebase-history-contract-"));
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* acquireEnvironment(
          temporary,
          createLocalGitCommandRunner(),
        );
        const server = yield* serveEnvironment(dependencies, {});
        const repository = yield* dependencies.catalog.remember(repositoryPath);
        const { credential } = yield* Effect.promise(async () => {
          const response = await fetch(
            new URL(environmentPairingExchangePath, server.origin),
            {
              body: JSON.stringify({
                label: "History contract fixture",
                pairingMaterial: new URL(server.pairingUrl).hash.slice(1),
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
          return Schema.decodeUnknownSync(EnvironmentPairingExchanged)(
            await response.json(),
          );
        });
        yield* Effect.sync(() => {
          globalThis.gc?.();
          process.stdout.write(
            `${JSON.stringify({ origin: server.origin, repositoryId: repository.id, credential, idleRssBytes: process.memoryUsage().rss })}\n`,
          );
        });
        yield* Effect.never;
      }),
    ),
    { signal: controller.signal },
  ).catch((error) => {
    if (!controller.signal.aborted) throw error;
  });
} finally {
  await removeTemporaryDirectory(temporary);
}
