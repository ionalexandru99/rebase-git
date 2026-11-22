import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentPairingExchanged,
  environmentPairingExchangePath,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  acquireEnvironment,
  serveEnvironment,
} from "#server/app/server/serve-environment.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const repositoryPath = process.argv[2];
if (repositoryPath === undefined)
  throw new Error("Missing prepared corpus path");
const temporary = await mkdtemp(join(tmpdir(), "rebase-history-contract-"));
const stopped = Promise.withResolvers<void>();
process.on("SIGTERM", () => stopped.resolve());
try {
  const dependencies = await acquireEnvironment(
    temporary,
    createLocalGitCommandRunner(),
  );
  try {
    const server = await serveEnvironment(dependencies, {});
    try {
      const repository = await dependencies.catalog.remember(repositoryPath);
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
      const { credential } = EnvironmentPairingExchanged.parse(
        await response.json(),
      );
      globalThis.gc?.();
      process.stdout.write(
        `${JSON.stringify({ origin: server.origin, repositoryId: repository.id, credential, idleRssBytes: process.memoryUsage().rss })}\n`,
      );
      await stopped.promise;
    } finally {
      await server.close();
    }
  } finally {
    await dependencies.close();
  }
} finally {
  await removeTemporaryDirectory(temporary);
}
