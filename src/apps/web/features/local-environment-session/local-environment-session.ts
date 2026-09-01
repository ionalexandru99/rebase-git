import { Effect, Fiber, Result } from "effect";
import {
  EnvironmentAuthorizationRejected,
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";
import { createEnvironmentFilesystemController } from "#web/features/environment-filesystem/environment-filesystem-controller";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionOptions,
  LocalEnvironmentSessionState,
} from "#web/features/local-environment-session/local-environment-session.contract";
import { createRepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller";
import {
  type RepositoryHistoryGateway,
  type RepositoryHistoryTransport,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
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
  const pairingMaterial = options.pairingMaterial;
  let state: LocalEnvironmentSessionState =
    pairingMaterial === undefined
      ? { _tag: "PairingRequired" }
      : { _tag: "Authorizing" };
  let credential: string | undefined;
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
      if (pairingMaterial === undefined) {
        return;
      }
      credential = yield* exchangePairing(options, pairingMaterial, publish);
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
    if (
      running ||
      (credential === undefined && pairingMaterial === undefined)
    ) {
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

function exchangePairing(
  options: LocalEnvironmentSessionOptions,
  pairingMaterial: string,
  publish: PublishState,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Authorizing" })
        : reconnectAfter(options, publish, attempt);
      const exchanged = yield* Effect.result(
        options.gateway.exchangePairing(pairingMaterial),
      );
      if (Result.isSuccess(exchanged)) {
        options.pairingSucceeded?.();
        return exchanged.success.credential;
      }

      const terminal = terminalState(exchanged.failure);
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
  credential: string,
  repositoryCatalog: LocalEnvironmentSession["repositoryCatalog"],
  repositoryRefs: LocalEnvironmentSession["repositoryRefs"],
  repositoryHistory: ReturnType<typeof createRepositoryHistoryGateway>,
  publish: PublishState,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let attempt = 0;
    let lastObservedSequence: number | undefined;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Connecting" })
        : reconnectAfter(options, publish, attempt);
      const connection = yield* Effect.result(
        Effect.scoped(
          options.gateway.connect(credential, lastObservedSequence).pipe(
            Effect.flatMap((active) =>
              Effect.sync(() =>
                repositoryHistory.connect(active.repositoryHistory),
              ).pipe(
                Effect.andThen(refreshRepositoryCatalog(repositoryCatalog)),
                Effect.andThen(Effect.sync(repositoryRefs.invalidate)),
                Effect.andThen(
                  publish({
                    _tag: "Connected",
                    environmentId: active.negotiated.environmentId,
                  }),
                ),
                Effect.andThen(
                  Effect.raceFirst(
                    active.closed,
                    observeEnvironmentChanges(
                      active,
                      repositoryRefs.invalidate,
                    ),
                  ).pipe(
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

function createRepositoryHistoryGateway() {
  let transport: RepositoryHistoryTransport | undefined;
  const gateway: RepositoryHistoryGateway = {
    read: (request, signal) => {
      const current = transport;
      if (current === undefined) {
        return Promise.reject(new RepositoryHistoryUnavailable());
      }
      return Effect.runPromise(
        current.read(request),
        signal === undefined ? undefined : { signal },
      );
    },
  };
  return {
    connect: (next: RepositoryHistoryTransport) => {
      transport = next;
    },
    disconnect: (current: RepositoryHistoryTransport) => {
      if (transport === current) {
        transport = undefined;
      }
    },
    gateway,
  };
}

function refreshRepositoryCatalog(
  repositoryCatalog: LocalEnvironmentSession["repositoryCatalog"],
) {
  return Effect.promise(() =>
    repositoryCatalog.refresh().catch(() => undefined),
  );
}

function observeEnvironmentChanges(
  connection: EnvironmentProtocolConnection,
  onChange: () => void,
): Effect.Effect<never> {
  return Effect.gen(function* () {
    let observed = connection.currentSequence();
    while (true) {
      const reached = yield* connection.waitForSequence(observed + 1);
      observed = Math.max(reached, observed + 1);
      onChange();
    }
  }).pipe(Effect.catch(() => Effect.never));
}

function reconnectAfter(
  options: LocalEnvironmentSessionOptions,
  publish: PublishState,
  attempt: number,
) {
  const delay = Math.min(250 * 2 ** (attempt - 1), 5_000);
  return publish({ _tag: "Reconnecting", attempt }).pipe(
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
