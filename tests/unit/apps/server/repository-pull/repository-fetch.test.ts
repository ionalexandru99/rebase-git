import { Deferred, Effect, Fiber, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vite-plus/test";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  acquireRepositoryFetch,
  type RepositoryFetch,
} from "#server/features/repository-pull/repository-fetch.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";

describe("repository fetch", () => {
  it("fetches when a repository is first shown and again on its interval while a client listens", () =>
    withFetch({ setting: "inherit" }, (fetch, git, events) =>
      Effect.gen(function* () {
        yield* fetch.status(repositoryId);
        yield* TestClock.adjust(0);
        expect(git.fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust(300_000);
        expect(git.fetch).toHaveBeenCalledTimes(1);
        const unsubscribe = events.subscribe(() => {});
        yield* TestClock.adjust(300_000);
        expect(git.fetch).toHaveBeenCalledTimes(2);
        unsubscribe();
      }),
    ));

  it("shares one Git fetch between callers of linked worktrees", () =>
    withFetch({}, (fetch, git) =>
      Effect.gen(function* () {
        const finish = yield* Deferred.make<void>();
        git.fetch.mockImplementation(() =>
          Deferred.await(finish).pipe(Effect.as(output())),
        );
        const first = yield* fetch.fetch(repositoryId).pipe(Effect.forkChild);
        const second = yield* fetch.fetch(linkedId).pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        expect(git.fetch).toHaveBeenCalledOnce();
        yield* Deferred.succeed(finish, undefined);
        expect(yield* Fiber.join(first)).toMatchObject({ fetching: false });
        expect(yield* Fiber.join(second)).toMatchObject({ fetching: false });
      }),
    ));

  it("reports failed fetches, including runner defects, and recovers", () =>
    withFetch({}, (fetch, git, events) =>
      Effect.gen(function* () {
        const changed = vi.fn();
        events.subscribe(changed);
        git.fetch
          .mockImplementationOnce(() => Effect.die(new Error("defect")))
          .mockImplementationOnce(() => Effect.fail(gitFailed("Timeout")));
        expect(yield* Effect.flip(fetch.fetch(repositoryId))).toEqual({
          _tag: "FetchFailed",
          reason: "Failed",
        });
        expect(yield* Effect.flip(fetch.fetch(repositoryId))).toEqual({
          _tag: "FetchFailed",
          reason: "Timeout",
        });
        expect(yield* fetch.status(repositoryId)).toMatchObject({
          failure: { _tag: "FetchFailed", reason: "Timeout" },
        });
        expect(yield* fetch.fetch(repositoryId)).not.toHaveProperty("failure");
        expect(changed).toHaveBeenCalledWith(
          expect.any(Number),
          [repositoryId],
          "Fetch",
        );
      }),
    ));

  it("replaces the schedule when configured and stops when disabled", () =>
    withFetch({ setting: "0" }, (fetch, git, events) =>
      Effect.gen(function* () {
        events.subscribe(() => {});
        yield* fetch.configure(repositoryId, { _tag: "Interval", seconds: 10 });
        yield* TestClock.adjust(5_000);
        yield* fetch.configure(repositoryId, { _tag: "Interval", seconds: 20 });
        yield* TestClock.adjust(19_000);
        expect(git.fetch).not.toHaveBeenCalled();
        yield* TestClock.adjust(1_000);
        expect(git.fetch).toHaveBeenCalledOnce();
        yield* fetch.configure(repositoryId, { _tag: "Disabled" });
        yield* TestClock.adjust(60_000);
        expect(git.fetch).toHaveBeenCalledOnce();
        expect(git.configured).toEqual(["10", "20", "0"]);
      }),
    ));
});

function output(stdout = "") {
  return { exitCode: 0, stdout, stderr: "" };
}

function withFetch(
  options: { readonly setting?: string },
  test: (
    fetch: RepositoryFetch,
    git: {
      readonly fetch: ReturnType<typeof vi.fn<GitCommandRunner["run"]>>;
      readonly configured: string[];
    },
    events: ReturnType<typeof createEnvironmentEventPublisher>,
  ) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const git = {
    fetch: vi.fn<GitCommandRunner["run"]>(() => Effect.succeed(output())),
    configured: [] as string[],
  };
  const runner: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) => {
      if (command.arguments[0] === "fetch") return git.fetch(command);
      const value = command.arguments[3];
      if (command.arguments[2] !== "--get" && value !== undefined)
        git.configured.push(value);
      return Effect.succeed(output(options.setting ?? "inherit"));
    },
  };
  const entry = (id: string): RepositoryCatalogEntry => ({
    id,
    logicalRepositoryId: repositoryId,
    path: id === linkedId ? "/linked" : "/repo",
    name: "repo",
    addedAt: "2026-09-04T00:00:00.000Z",
    lastOpenedAt: "2026-09-04T00:00:00.000Z",
  });
  const access: RepositoryAccess = {
    repository: (id) => Effect.succeed(entry(id)),
    worktrees: () => Effect.succeed([]),
    requireWorktree: () => Effect.void,
  };
  const events = createEnvironmentEventPublisher();
  return Effect.runPromise(
    Effect.gen(function* () {
      const fetch = yield* acquireRepositoryFetch({
        access,
        coordination: {
          run: (_directory, _policy, operation) => operation,
          operation: () => Effect.die("Fetch never reads operations."),
        },
        events,
        git: runner,
      });
      yield* test(fetch, git, events);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
}
