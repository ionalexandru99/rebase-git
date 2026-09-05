import { Effect, Fiber, Result } from "effect";
import {
  EnvironmentAuthorizationRejected,
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { createEnvironmentFilesystemController } from "#web/features/environment-filesystem/environment-filesystem-controller";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionOptions,
  LocalEnvironmentSessionState,
} from "#web/features/local-environment-session/local-environment-session.contract";
import { createRepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller";
import { createRepositoryHistoryGateway } from "#web/features/repository-history/transport/repository-history-gateway";
import { createRepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller";

export function createLocalEnvironmentSession(
  options: LocalEnvironmentSessionOptions,
): LocalEnvironmentSession {
  const repositoryCatalogSession = createRepositoryCatalogController(
    options.repositoryCatalogGateway,
  );
  const filesystemSession = createEnvironmentFilesystemController(
    options.filesystemGateway,
  );
  const repositoryRefsSession = createRepositoryRefsController(
    options.repositoryRefsGateway,
  );
  const repositoryHistory = createRepositoryHistoryGateway();
  const listeners = new Set<() => void>();
  let credential: EnvironmentCredential | undefined;
  let state: LocalEnvironmentSessionState = { _tag: "Authorizing" };
  let fiber: Fiber.Fiber<void, never> | undefined;
  let running = false;

  const publish: PublishState = (next) =>
    Effect.sync(() => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    });

  const runSession = Effect.gen(function* () {
    if (credential === undefined) {
      credential = yield* authorizeSession(options, publish);
    }
    repositoryCatalogSession.authorize(credential);
    filesystemSession.authorize(credential);
    repositoryRefsSession.authorize(credential);
    yield* maintainConnection(
      options,
      credential,
      repositoryCatalogSession.controller,
      repositoryRefsSession.controller,
      repositoryHistory,
      publish,
    );
  });

  const start = () => {
    if (running) {
      return;
    }

    running = true;
    fiber = Effect.runFork(
      runSession.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running = false;
            fiber = undefined;
          }),
        ),
      ),
    );
  };

  const stop = () => {
    if (!running) {
      return;
    }
    const activeFiber = fiber;
    if (activeFiber !== undefined) {
      Effect.runFork(Fiber.interrupt(activeFiber));
    }
  };

  return {
    filesystem: filesystemSession.controller,
    getSnapshot: () => state,
    repositoryCatalog: repositoryCatalogSession.controller,
    repositoryHistory: repositoryHistory.gateway,
    repositoryRefs: repositoryRefsSession.controller,
    start,
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function authorizeSession(
  options: LocalEnvironmentSessionOptions,
  publish: PublishState,
): Effect.Effect<EnvironmentCredential> {
  return Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Authorizing" })
        : reconnectAfter(options, publish, attempt);
      const authorized = yield* Effect.result(options.gateway.authorize());
      if (Result.isSuccess(authorized)) {
        return authorized.success;
      }

      const terminal =
        authorized.failure instanceof EnvironmentAuthorizationRejected &&
        authorized.failure.failure._tag === "InvalidGrant"
          ? { _tag: "PairingRequired" as const }
          : terminalState(authorized.failure);
      if (terminal !== undefined) {
        yield* publish(terminal);
        return yield* Effect.interrupt;
      }
      attempt += 1;
    }
  });
}

function maintainConnection(
  options: LocalEnvironmentSessionOptions,
  credential: EnvironmentCredential,
  repositoryCatalog: LocalEnvironmentSession["repositoryCatalog"],
  repositoryRefs: LocalEnvironmentSession["repositoryRefs"],
  repositoryHistory: ReturnType<typeof createRepositoryHistoryGateway>,
  publish: PublishState,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let attempt = 0;
    let environmentId: string | undefined;
    let lastObservedSequence: number | undefined;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Connecting" })
        : reconnectAfter(options, publish, attempt, environmentId);
      const connection = yield* Effect.result(
        Effect.scoped(
          options.gateway.connect(credential, lastObservedSequence).pipe(
            Effect.flatMap((active) =>
              Effect.acquireRelease(
                Effect.sync(() =>
                  active.subscribeChanges(repositoryRefs.invalidate),
                ),
                (unsubscribe) => Effect.sync(unsubscribe),
              ).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    repositoryHistory.connect(active.repositoryHistory);
                    environmentId = active.negotiated.environmentId;
                  }),
                ),
                Effect.andThen(refreshRepositoryCatalog(repositoryCatalog)),
                Effect.andThen(Effect.sync(repositoryRefs.invalidate)),
                Effect.andThen(
                  publish({
                    _tag: "Connected",
                    environmentId: active.negotiated.environmentId,
                    accessCapabilities:
                      active.negotiated.accessCapabilities ?? [],
                  }),
                ),
                Effect.andThen(
                  active.closed.pipe(
                    Effect.map((failure) => ({
                      failure,
                      lastObservedSequence: active.currentSequence(),
                    })),
                  ),
                ),
                Effect.ensuring(
                  Effect.sync(() =>
                    repositoryHistory.disconnect(active.repositoryHistory),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      const failure = Result.isFailure(connection)
        ? connection.failure
        : connection.success.failure;
      const terminal = terminalState(failure);
      if (terminal !== undefined) {
        yield* publish(terminal);
        return yield* Effect.interrupt;
      }

      if (Result.isSuccess(connection)) {
        lastObservedSequence = connection.success.lastObservedSequence;
        attempt = 1;
      } else {
        attempt += 1;
      }
    }
  });
}

function refreshRepositoryCatalog(
  repositoryCatalog: LocalEnvironmentSession["repositoryCatalog"],
) {
  return Effect.promise(() =>
    repositoryCatalog.refresh().catch(() => undefined),
  );
}

function reconnectAfter(
  options: LocalEnvironmentSessionOptions,
  publish: PublishState,
  attempt: number,
  environmentId?: string,
) {
  const delay = Math.min(250 * 2 ** (attempt - 1), 5_000);
  return publish({
    _tag: "Reconnecting",
    attempt,
    ...(environmentId === undefined ? {} : { environmentId }),
  }).pipe(
    Effect.andThen(
      options.waitBeforeReconnect?.(attempt) ?? Effect.sleep(delay),
    ),
  );
}

function terminalState(
  failure: EnvironmentConnectionFailure,
): LocalEnvironmentSessionState | undefined {
  if (failure instanceof EnvironmentAuthorizationRejected) {
    return { _tag: "AuthorizationFailed", failure };
  }
  if (failure instanceof EnvironmentHelloRejected) {
    return {
      _tag: "ProtocolMismatch",
      message: protocolMismatchMessage(failure),
    };
  }
  return undefined;
}

function protocolMismatchMessage(failure: EnvironmentHelloRejected) {
  if (
    failure.failure._tag === "ProtocolMajorMismatch" &&
    failure.failure.requiredUpdate === "server"
  ) {
    return "The local Rebase server is older than this browser client. Update the local package and restart Rebase.";
  }
  return "This browser client cannot use the local Rebase protocol. Reload the page, then update the local package if the mismatch remains.";
}

type PublishState = (
  state: LocalEnvironmentSessionState,
) => Effect.Effect<void>;
