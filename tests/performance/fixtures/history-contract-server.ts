import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentAuthorizationHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import {
  createEnvironmentRequestClient,
  exchangeEnvironmentPairingEffect,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { startEnvironmentServer } from "#server/app/server/start-environment-server";
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
        const server = yield* startEnvironmentServer({ home: temporary });
        const { credential } = yield* exchangeEnvironmentPairingEffect(
          server.origin,
          {
            label: "History contract fixture",
            pairingMaterial: new URL(server.pairingUrl).hash.slice(1),
          },
        );
        const requests = createEnvironmentRequestClient(server.origin, () => ({
          type: "bearer",
          value: credential,
        }));
        const repository = yield* Effect.promise(() =>
          requests(RepositoryCatalogHttpApi.remember, { path: repositoryPath }),
        );
        const { ticket } = yield* Effect.promise(() =>
          requests(
            EnvironmentAuthorizationHttpApi.mintWebSocketTicket,
            undefined,
          ),
        );
        yield* Effect.sync(() => {
          globalThis.gc?.();
          process.stdout.write(
            `${JSON.stringify({ origin: server.origin, repositoryId: repository.id, ticket, idleRssBytes: process.memoryUsage().rss })}\n`,
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
