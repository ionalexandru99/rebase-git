import { environmentProtocol } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type EnvironmentConnection,
  type EnvironmentConnectionFailure,
  type EnvironmentCredential,
  isEnvironmentConnectionFailure,
  reconnectDelay,
} from "#web/platform/environment/environment-connection.ts";
import type {
  EnvironmentRequests,
  EnvironmentSubscriptions,
} from "#web/platform/query/environment-context.tsx";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation.ts";
import { createStore, type ReadableStore } from "#web/platform/store/store.ts";

export type LocalEnvironmentSessionState =
  | { readonly _tag: "PairingRequired" }
  | { readonly _tag: "Authorizing" }
  | { readonly _tag: "Connecting" }
  | {
      readonly _tag: "Connected";
      readonly environmentId: string;
      readonly requests: EnvironmentRequests;
      readonly subscribe: EnvironmentSubscriptions;
    }
  | {
      readonly _tag: "Reconnecting";
      readonly attempt: number;
      readonly environmentId?: string;
    }
  | {
      readonly _tag: "AuthorizationFailed";
      readonly failure: Extract<
        EnvironmentConnectionFailure,
        { readonly _tag: "EnvironmentAccessDenied" }
      >;
    }
  | {
      readonly _tag: "ProtocolMismatch";
      readonly message: string;
    };

export interface LocalEnvironmentSession
  extends ReadableStore<LocalEnvironmentSessionState> {
  readonly start: () => void;
  readonly stop: () => void;
}

export interface LocalEnvironmentGateway {
  readonly authorize: () => Promise<EnvironmentCredential>;
  readonly connect: (
    credential: EnvironmentCredential,
  ) => Promise<EnvironmentConnection>;
}

export interface LocalEnvironmentSessionOptions {
  readonly gateway: LocalEnvironmentGateway;
  readonly invalidation: EnvironmentInvalidation;
  readonly onConnect?: (credential: EnvironmentCredential) => void;
  readonly waitBeforeReconnect?: (attempt: number) => Promise<void>;
}

type Publish = (state: LocalEnvironmentSessionState) => void;

const unavailable: EnvironmentConnectionFailure = {
  _tag: "EnvironmentUnavailable",
};

export function createLocalEnvironmentSession(
  options: LocalEnvironmentSessionOptions,
): LocalEnvironmentSession {
  const state = createStore<LocalEnvironmentSessionState>({
    _tag: "Authorizing",
  });
  let credential: EnvironmentCredential | undefined;
  let running: AbortController | undefined;

  const run = async (signal: AbortSignal) => {
    const publish: Publish = (next) => {
      if (!signal.aborted) state.set(next);
    };
    const current =
      credential ?? (await authorizeSession(options, publish, signal));
    if (current === undefined || signal.aborted) return;
    credential = current;
    await maintainConnection(options, current, publish, signal);
  };

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    start: () => {
      if (running !== undefined) return;
      const current = new AbortController();
      running = current;
      void run(current.signal).finally(() => {
        if (running === current) running = undefined;
      });
    },
    stop: () => {
      running?.abort();
      running = undefined;
    },
  };
}

async function authorizeSession(
  options: LocalEnvironmentSessionOptions,
  publish: Publish,
  signal: AbortSignal,
) {
  for (let attempt = 0; !signal.aborted; attempt += 1) {
    if (attempt === 0) publish({ _tag: "Authorizing" });
    else await reconnectAfter(options, publish, attempt);
    if (signal.aborted) return undefined;
    try {
      return await options.gateway.authorize();
    } catch (error) {
      const terminal = terminalState(connectionFailure(error), {
        type: "browser-session",
      });
      if (terminal !== undefined) {
        publish(terminal);
        return undefined;
      }
    }
  }
  return undefined;
}

async function maintainConnection(
  options: LocalEnvironmentSessionOptions,
  credential: EnvironmentCredential,
  publish: Publish,
  signal: AbortSignal,
) {
  let attempt = 0;
  let environmentId: string | undefined;
  while (!signal.aborted) {
    if (attempt === 0) publish({ _tag: "Connecting" });
    else await reconnectAfter(options, publish, attempt, environmentId);
    if (signal.aborted) return;
    let failure = unavailable;
    try {
      const active = await options.gateway.connect(credential);
      environmentId = active.environmentId;
      await serveConnection(options, credential, active, publish, signal);
      attempt = 1;
    } catch (error) {
      failure = connectionFailure(error);
      attempt += 1;
    }
    const terminal = terminalState(failure, credential);
    if (terminal !== undefined) {
      publish(terminal);
      return;
    }
  }
}

async function serveConnection(
  options: LocalEnvironmentSessionOptions,
  credential: EnvironmentCredential,
  active: EnvironmentConnection,
  publish: Publish,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    active.close();
    return;
  }
  signal.addEventListener("abort", active.close, { once: true });
  try {
    options.onConnect?.(credential);
    options.invalidation.changed();
    publish({
      _tag: "Connected",
      environmentId: active.environmentId,
      requests: active.requests,
      subscribe: active.subscribe,
    });
    await active.closed;
  } finally {
    signal.removeEventListener("abort", active.close);
    active.close();
  }
}

function reconnectAfter(
  options: LocalEnvironmentSessionOptions,
  publish: Publish,
  attempt: number,
  environmentId?: string,
) {
  publish({
    _tag: "Reconnecting",
    attempt,
    ...(environmentId === undefined ? {} : { environmentId }),
  });
  return (
    options.waitBeforeReconnect?.(attempt) ??
    new Promise<void>((resolve) => setTimeout(resolve, reconnectDelay(attempt)))
  );
}

function connectionFailure(error: unknown) {
  return isEnvironmentConnectionFailure(error) ? error : unavailable;
}

function terminalState(
  failure: EnvironmentConnectionFailure,
  credential: EnvironmentCredential,
): LocalEnvironmentSessionState | undefined {
  if (failure._tag === "EnvironmentAccessDenied")
    return failure.failure._tag === "InvalidGrant" &&
      credential.type === "browser-session"
      ? { _tag: "PairingRequired" }
      : { _tag: "AuthorizationFailed", failure };
  if (failure._tag === "EnvironmentProtocolMismatch")
    return {
      _tag: "ProtocolMismatch",
      message:
        failure.serverProtocol < environmentProtocol
          ? "The local Rebase server is older than this browser client. Update the local package and restart Rebase."
          : "This browser client cannot use the local Rebase protocol. Reload the page, then update the local package if the mismatch remains.",
    };
  return undefined;
}
