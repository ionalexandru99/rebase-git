import type {
  EnvironmentAccessCapability,
  EnvironmentServerMessage,
  RepositoryFreshnessClientMessage,
} from "@rebase/contracts";
import type { RepositoryFreshnessService } from "@rebase/server/domain/repository-freshness.contract";
import { acquireRepositoryFreshnessSession } from "@rebase/server/features/environment-connection/websocket/repository-freshness-session";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

describe("repository freshness session", () => {
  it("requires write access for fetch and settings without ending the subscription", async () => {
    const fixture = createFixture();
    await withSession(fixture, ["repository.read"], async (handle) => {
      await handle({
        _tag: "SubscribeRepositoryHistory",
        repositoryId,
        requestId,
      });
      await handle({ _tag: "FetchRepositoryHistory", repositoryId, requestId });
      await handle({
        _tag: "ConfigureRepositoryFetch",
        repositoryId,
        requestId,
        setting: { _tag: "Disabled" },
      });
      expect(fixture.messages).toEqual([
        {
          _tag: "RepositoryHistoryFailed",
          requestId,
          failure: { _tag: "AuthorizationDenied" },
        },
        {
          _tag: "RepositoryHistoryFailed",
          requestId,
          failure: { _tag: "AuthorizationDenied" },
        },
      ]);
      expect(fixture.release).not.toHaveBeenCalled();
      expect(fixture.service.fetch).not.toHaveBeenCalled();
      expect(fixture.service.configure).not.toHaveBeenCalled();
    });
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("releases a subscription that finishes opening after its browser unsubscribes", async () => {
    const fixture = createFixture();
    let finish: (() => void) | undefined;
    fixture.service.subscribe.mockImplementation(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ).pipe(Effect.as(fixture.release)),
    );
    await withSession(fixture, ["repository.read"], async (handle) => {
      await handle({
        _tag: "SubscribeRepositoryHistory",
        repositoryId,
        requestId,
      });
      await handle({ _tag: "UnsubscribeRepositoryHistory", repositoryId });
      finish?.();
      await Promise.all(fixture.jobs);
      expect(fixture.release).toHaveBeenCalledOnce();
    });
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("requires an active subscription before mutating a repository", async () => {
    const fixture = createFixture();
    await withSession(
      fixture,
      ["repository.read", "repository.write"],
      async (handle) => {
        await handle({
          _tag: "FetchRepositoryHistory",
          repositoryId,
          requestId,
        });
        expect(fixture.messages[0]).toMatchObject({
          _tag: "RepositoryHistoryFailed",
        });
        expect(fixture.service.fetch).not.toHaveBeenCalled();
      },
    );
  });
});

function createFixture() {
  const release = vi.fn();
  const service = {
    subscribe: vi.fn<RepositoryFreshnessService["subscribe"]>(() =>
      Effect.succeed(release),
    ),
    fetch: vi.fn<RepositoryFreshnessService["fetch"]>(() =>
      Effect.die("unused"),
    ),
    configure: vi.fn<RepositoryFreshnessService["configure"]>(() =>
      Effect.die("unused"),
    ),
  };
  return {
    release,
    service,
    messages: [] as EnvironmentServerMessage[],
    jobs: [] as Promise<void>[],
  };
}

function withSession(
  fixture: ReturnType<typeof createFixture>,
  access: readonly EnvironmentAccessCapability[],
  use: (
    handle: (message: RepositoryFreshnessClientMessage) => Promise<void>,
  ) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const handle = yield* acquireRepositoryFreshnessSession(
        fixture.service,
        {
          send: (message) =>
            Effect.sync(() => {
              fixture.messages.push(message);
            }),
        },
        new Map([["repository-history-freshness", 1]]),
        new Set(access),
        (effect) => {
          fixture.jobs.push(Effect.runPromise(effect));
        },
      );
      yield* Effect.promise(() =>
        use((message) => Effect.runPromise(handle(message))),
      );
      yield* Effect.promise(() => Promise.all(fixture.jobs));
    }).pipe(Effect.scoped),
  );
}
