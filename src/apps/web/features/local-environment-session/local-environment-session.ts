import {
  EnvironmentAuthorizationRejected,
  EnvironmentHelloRejected,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionOptions,
  LocalEnvironmentSessionState,
} from "#web/features/local-environment-session/local-environment-session.contract";

export function createLocalEnvironmentSession(
  options: LocalEnvironmentSessionOptions,
): LocalEnvironmentSession {
  const listeners = new Set<() => void>();
  const pairingMaterial = options.pairingMaterial;
  let state: LocalEnvironmentSessionState =
    pairingMaterial === undefined
      ? { _tag: "PairingRequired" }
      : { _tag: "Authorizing" };
  let runId = 0;
  let running = false;
  let credential: string | undefined;
  let activeConnection: EnvironmentProtocolConnection | undefined;
  let controller: AbortController | undefined;

  const publish = (next: LocalEnvironmentSessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const isCurrentRun = (currentRunId: number) =>
    running && currentRunId === runId;

  const stop = () => {
    if (!running) return;
    running = false;
    runId += 1;
    controller?.abort();
    controller = undefined;
    activeConnection?.close();
    activeConnection = undefined;
  };

  const start = () => {
    if (
      running ||
      (credential === undefined && pairingMaterial === undefined)
    ) {
      return;
    }

    running = true;
    const currentRunId = ++runId;
    controller = new AbortController();
    void runSession(currentRunId, controller.signal).catch(() => undefined);
  };

  const runSession = async (currentRunId: number, signal: AbortSignal) => {
    if (credential === undefined) {
      if (pairingMaterial === undefined) return;
      publish({ _tag: "Authorizing" });
      try {
        const exchanged = await options.gateway.exchangePairing(
          pairingMaterial,
          signal,
        );
        if (!isCurrentRun(currentRunId)) return;
        credential = exchanged.credential;
        options.pairingSucceeded?.();
      } catch (failure) {
        if (!isCurrentRun(currentRunId)) return;
        const terminal = terminalState(failure);
        if (terminal !== undefined) {
          publish(terminal);
          running = false;
          return;
        }
        await reconnectAfter(currentRunId, signal, 1);
        if (isCurrentRun(currentRunId)) {
          void runSession(currentRunId, signal);
        }
        return;
      }
    }

    let reconnectAttempt = 0;
    let lastObservedSequence: number | undefined;
    while (isCurrentRun(currentRunId)) {
      publish(
        reconnectAttempt === 0
          ? { _tag: "Connecting" }
          : { _tag: "Reconnecting", attempt: reconnectAttempt },
      );

      try {
        const connection = await options.gateway.connect(
          credential,
          lastObservedSequence,
          signal,
        );
        if (!isCurrentRun(currentRunId)) {
          connection.close();
          return;
        }

        activeConnection = connection;
        reconnectAttempt = 0;
        publish({
          _tag: "Connected",
          environmentId: connection.negotiated.environmentId,
        });
        const failure = await connection.closed;
        lastObservedSequence = connection.currentSequence();
        activeConnection = undefined;
        if (!isCurrentRun(currentRunId)) return;
        throw failure;
      } catch (failure) {
        if (!isCurrentRun(currentRunId)) return;
        const terminal = terminalState(failure);
        if (terminal !== undefined) {
          publish(terminal);
          running = false;
          return;
        }
      }

      reconnectAttempt += 1;
      await reconnectAfter(currentRunId, signal, reconnectAttempt);
    }
  };

  const reconnectAfter = async (
    currentRunId: number,
    signal: AbortSignal,
    attempt: number,
  ) => {
    publish({ _tag: "Reconnecting", attempt });
    await (options.waitBeforeReconnect ?? waitBeforeReconnect)(attempt, signal);
    if (!isCurrentRun(currentRunId)) return;
  };

  return {
    getSnapshot: () => state,
    start,
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function terminalState(
  failure: unknown,
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

function waitBeforeReconnect(attempt: number, signal: AbortSignal) {
  const delay = Math.min(250 * 2 ** (attempt - 1), 5_000);
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}
