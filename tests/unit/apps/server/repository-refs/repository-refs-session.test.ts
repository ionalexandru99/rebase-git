import type { RepositoryRefs } from "@rebase/contracts";
import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import { acquireRepositoryRefsSession } from "#server/features/repository-refs/websocket/repository-refs-session";

it("releases synchronously completed reads before admitting the next request", async () => {
  const repositoryId = "00000000-0000-4000-8000-000000000001";
  const refs: RepositoryRefs = {
    repositoryId,
    branches: [],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
  };
  const service: RepositoryRefsService = {
    read: () => Effect.succeed(refs),
    checkout: () => Effect.die("Checkout is not used"),
  };
  const writer = {
    send: vi.fn(() => Effect.void),
    sendJson: vi.fn(() => Effect.void),
  };

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* acquireRepositoryRefsSession(
          service,
          writer,
          new Set(["repository.read"]),
        );
        for (let index = 1; index <= 3; index += 1) {
          yield* handle({
            _tag: "ReadRepositoryRefs",
            repositoryId,
            requestId: `00000000-0000-4000-8000-00000000000${index}`,
          });
        }
      }),
    ),
  );

  expect(writer.sendJson).toHaveBeenCalledTimes(3);
  expect(writer.send).not.toHaveBeenCalled();
});
