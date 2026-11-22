import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { CommandProgressApi } from "#contracts/command-progress/command-progress.contract.ts";
import {
  type EnvironmentAccessFailure,
  EnvironmentAuthorizationFailure,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  EnvironmentSessionApi,
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
  ProtocolMismatch,
  unauthorizedCloseCode,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  RepositoryHistoryApi,
  type RepositoryHistoryUpdate,
  type SynchronizeRepositoryHistory,
} from "#contracts/repository-history/repository-history.contract.ts";
import type {
  EnvironmentRequests,
  EnvironmentSubscriptions,
} from "#web/platform/query/environment-context.tsx";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation.ts";
import { inputRepositoryId } from "#web/platform/query/environment-query.ts";
import type { RequestFailure } from "#web/platform/query/request-failure.ts";

export type EnvironmentCredential =
  | { readonly type: "browser-session" }
  | { readonly type: "bearer"; readonly value: string };

export interface EnvironmentAccess {
  readonly origin: string;
  readonly credential: EnvironmentCredential;
}

export type EnvironmentConnectionFailure =
  | {
      readonly _tag: "EnvironmentAccessDenied";
      readonly failure: EnvironmentAccessFailure;
    }
  | {
      readonly _tag: "EnvironmentProtocolMismatch";
      readonly serverProtocol: number;
    }
  | { readonly _tag: "EnvironmentUnavailable" };

export interface EnvironmentConnection {
  readonly environmentId: string;
  readonly requests: EnvironmentRequests;
  readonly subscribe: EnvironmentSubscriptions;
  readonly closed: Promise<void>;
  readonly close: () => void;
}

type Procedure = (
  input: unknown,
  options?: { readonly signal?: AbortSignal },
) => Promise<unknown>;

type Procedures = Readonly<Record<string, Procedure>>;

interface SocketClosed {
  readonly _tag: "SocketClosed";
  readonly code: number;
  readonly reason: string;
}

const greetingDeadlineMilliseconds = 10_000;
const silenceDeadlineMilliseconds = 90_000;
const unavailable: EnvironmentConnectionFailure = {
  _tag: "EnvironmentUnavailable",
};
const unanswered: RequestFailure<never> = { _tag: "Unanswered" };

export function reconnectDelay(attempt: number) {
  return Math.min(250 * 2 ** (attempt - 1), 5_000);
}

export function isEnvironmentConnectionFailure(
  error: unknown,
): error is EnvironmentConnectionFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error._tag === "EnvironmentAccessDenied" ||
      error._tag === "EnvironmentProtocolMismatch" ||
      error._tag === "EnvironmentUnavailable")
  );
}

export async function connectEnvironment(
  origin: string,
  credential: EnvironmentCredential,
  invalidation: EnvironmentInvalidation,
): Promise<EnvironmentConnection> {
  const socket = openSocket(origin, credential);
  const ended = Promise.withResolvers<SocketClosed>();
  socket.addEventListener(
    "close",
    (event) =>
      ended.resolve({
        _tag: "SocketClosed",
        code: event.code,
        reason: event.reason,
      }),
    { once: true },
  );
  const closed = ended.promise;
  const procedures = createORPCClient<Procedures>(
    new RPCLink({ websocket: discardingAfterClose(socket) }),
  );
  const open = () => socket.readyState <= WebSocket.OPEN;
  const requests = environmentRequests(procedures, open);
  const subscribe = environmentSubscriptions(procedures, open);
  const close = () => {
    socket.close();
    ended.resolve({ _tag: "SocketClosed", code: 1006, reason: "" });
  };
  try {
    const [greeting] = await beforeClose(
      Promise.all([
        requests(EnvironmentSessionApi.hello, {
          protocol: environmentProtocol,
        }),
        watchEnvironment(subscribe, invalidation, close),
      ]),
      closed,
    );
    return {
      environmentId: greeting.environmentId,
      requests,
      subscribe,
      closed: closed.then(() => undefined),
      close,
    };
  } catch (error) {
    close();
    throw connectionFailure(error);
  }
}

export function environmentRequests(
  procedures: Procedures,
  open: () => boolean,
): EnvironmentRequests {
  return async <Route extends EnvironmentRoute>(
    route: Route,
    input: RouteInput<Route>,
    options?: Parameters<EnvironmentRequests>[2],
  ) => {
    const call = procedures[route._tag];
    if (call === undefined || !open()) throw unanswered;
    const signal = options?.signal;
    const progress = options?.progress;
    const repositoryId = inputRepositoryId(input);
    const watching = new AbortController();
    if (progress !== undefined && repositoryId !== null)
      environmentSubscriptions(procedures, open)(
        CommandProgressApi.watch,
        { repositoryId, route: route._tag },
        progress,
        watching.signal,
      ).catch(() => undefined);
    try {
      return (await call(
        input,
        signal === undefined ? undefined : { signal },
      )) as RouteSuccess<Route>;
    } catch (error) {
      throw requestFailure(error, signal);
    } finally {
      watching.abort();
    }
  };
}

export function environmentSubscriptions(
  procedures: Procedures,
  open: () => boolean,
): EnvironmentSubscriptions {
  return async (route, input, accept, signal) => {
    const call = procedures[route._tag];
    if (call === undefined || !open()) throw unanswered;
    const credits = createCredits();
    let rejected: { readonly error: unknown } | undefined;
    try {
      const values = (await call(streamRequest(input, credits), {
        signal,
      })) as AsyncIterable<never>;
      credits.open();
      for await (const value of values) {
        try {
          await accept(value);
        } catch (error) {
          rejected = { error };
          break;
        }
        credits.grant();
      }
    } catch (error) {
      throw requestFailure(error, signal);
    } finally {
      credits.close();
    }
    if (rejected !== undefined) throw rejected.error;
  };
}

export interface EnvironmentSocket {
  readonly environmentId: string;
  readonly synchronizeHistory: (
    request: SynchronizeRepositoryHistory,
    accept: (update: RepositoryHistoryUpdate) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly closed: Promise<void>;
}

export async function openEnvironmentSocket(
  origin: string,
  credential: EnvironmentCredential,
  invalidation: EnvironmentInvalidation,
): Promise<EnvironmentSocket> {
  const connection = await connectEnvironment(
    origin,
    credential,
    invalidation,
  ).catch(() => Promise.reject(unanswered));
  return {
    environmentId: connection.environmentId,
    synchronizeHistory: (request, accept, signal) =>
      connection.subscribe(
        RepositoryHistoryApi.synchronize,
        request,
        accept,
        signal,
      ),
    closed: connection.closed,
  };
}

export const unavailableRequests: EnvironmentRequests = async () => {
  throw unanswered;
};

export const unavailableSubscriptions: EnvironmentSubscriptions = async () => {
  throw unanswered;
};

function openSocket(origin: string, credential: EnvironmentCredential) {
  const url = new URL(environmentLivePath, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    url.href,
    credential.type === "bearer"
      ? [environmentSubprotocol, credential.value]
      : [environmentSubprotocol],
  );
}

function watchEnvironment(
  subscribe: EnvironmentSubscriptions,
  invalidation: EnvironmentInvalidation,
  close: () => void,
) {
  const watching = Promise.withResolvers<void>();
  let sequence: number | undefined;
  let silence = setTimeout(close, silenceDeadlineMilliseconds);
  subscribe(
    EnvironmentSessionApi.watch,
    undefined,
    (change) => {
      clearTimeout(silence);
      silence = setTimeout(close, silenceDeadlineMilliseconds);
      if (sequence === undefined) {
        sequence = change.sequence;
        watching.resolve();
        return;
      }
      if (change.sequence <= sequence) return;
      if (change.sequence === sequence + 1)
        invalidation.changed(change.repositoryIds, change.kind);
      else invalidation.changed();
      sequence = change.sequence;
    },
    new AbortController().signal,
  )
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(silence);
      watching.reject(unavailable);
      close();
    });
  return watching.promise;
}

async function* streamRequest(
  input: unknown,
  credits: ReturnType<typeof createCredits>,
) {
  if (!(await credits.opened)) return;
  yield input;
  while (await credits.next()) yield null;
}

function discardingAfterClose(socket: WebSocket) {
  return {
    get readyState() {
      return socket.readyState === WebSocket.CONNECTING
        ? WebSocket.CONNECTING
        : WebSocket.OPEN;
    },
    addEventListener: socket.addEventListener.bind(socket),
    removeEventListener: socket.removeEventListener.bind(socket),
    send: (data: Parameters<WebSocket["send"]>[0]) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
  };
}

function createCredits() {
  let available = 0;
  let open = true;
  let waiting: ((granted: boolean) => void) | undefined;
  const opened = Promise.withResolvers<boolean>();
  const settle = (granted: boolean) => {
    const resolve = waiting;
    waiting = undefined;
    resolve?.(granted);
  };
  return {
    opened: opened.promise,
    open: () => opened.resolve(true),
    grant: () => {
      available += 1;
      settle(true);
    },
    close: () => {
      open = false;
      opened.resolve(false);
      settle(false);
    },
    next: () => {
      if (!open) return Promise.resolve(false);
      if (available > 0) {
        available -= 1;
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        waiting = (granted) => {
          if (granted) available -= 1;
          resolve(granted);
        };
      });
    },
  };
}

async function beforeClose<Value>(
  request: Promise<Value>,
  closed: Promise<SocketClosed>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Value>((resolve, reject) => {
      timer = setTimeout(
        () => reject(unavailable),
        greetingDeadlineMilliseconds,
      );
      request.then(resolve, reject);
      closed.then(reject);
    });
  } finally {
    clearTimeout(timer);
  }
}

function requestFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): RequestFailure<unknown> {
  if (signal?.aborted) return { _tag: "Cancelled" };
  if (error instanceof ORPCError && error.code === "Rejected")
    return { _tag: "Rejected", failure: error.data };
  return unanswered;
}

function connectionFailure(error: unknown): EnvironmentConnectionFailure {
  const reason = error as Partial<RequestFailure<unknown> | SocketClosed>;
  const mismatch =
    reason._tag === "Rejected"
      ? ProtocolMismatch.safeParse(reason.failure)
      : undefined;
  if (mismatch?.success)
    return {
      _tag: "EnvironmentProtocolMismatch",
      serverProtocol: mismatch.data.serverProtocol,
    };
  if (reason._tag === "SocketClosed" && reason.code === unauthorizedCloseCode) {
    const failure = EnvironmentAuthorizationFailure.safeParse({
      _tag: reason.reason,
    });
    if (failure.success)
      return { _tag: "EnvironmentAccessDenied", failure: failure.data };
  }
  return unavailable;
}
