import {
  createCurrentEnvironmentHello,
  type EnvironmentDiscovery,
  type EnvironmentHello,
  EnvironmentHelloResult,
  EnvironmentHello as EnvironmentHelloSchema,
  EnvironmentServerMessage,
  negotiateEnvironmentHello,
  SnapshotApplied,
} from "@rebase/contracts";
import {
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  environmentResponseError,
} from "@rebase/web/state/server/environment-connection-errors";
import {
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
  fetchEnvironmentSnapshotWithinLimit,
} from "@rebase/web/state/server/environment-http-client";
import { advanceEnvironmentSequence } from "@rebase/web/state/server/environment-sequence";
import { Schema } from "effect";

export {
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
};

type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;

export interface EnvironmentProtocolConnection {
  readonly close: () => void;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly negotiated: NegotiatedEnvironment;
  readonly waitForSequence: (sequence: number) => Promise<number>;
}

export async function connectCurrentEnvironment(
  origin: string,
  productVersion: string,
  options: {
    readonly lastObservedSequence?: number;
    readonly signal?: AbortSignal;
  } = {},
) {
  const discovery = await fetchEnvironmentDiscovery(origin, options.signal);
  return connectEnvironment(
    origin,
    discovery,
    createCurrentEnvironmentHello(productVersion, options.lastObservedSequence),
    options.signal,
  );
}

export function connectEnvironment(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  signal?: AbortSignal,
): Promise<EnvironmentProtocolConnection> {
  const socketUrl = new URL(discovery.routes.live, normalizeOrigin(origin));
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(socketUrl);

  return new Promise((resolveConnection, rejectConnection) => {
    let active = false;
    let currentSequence = hello.lastObservedSequence ?? 0;
    let negotiated: NegotiatedEnvironment | undefined;
    let supportsEnvironmentEvents = false;
    let supportsResnapshot = false;
    let recovery: Promise<void> | undefined;
    let messagePipeline = Promise.resolve();
    let terminalFailure: unknown;
    const sequenceWaiters = new Set<SequenceWaiter>();

    const fail = (error: unknown) => {
      if (terminalFailure !== undefined) {
        return;
      }
      terminalFailure = error;
      if (!active) {
        rejectConnection(error);
      }
      for (const waiter of sequenceWaiters) {
        waiter.reject(error);
      }
      sequenceWaiters.clear();
      cleanup();
      socket.close();
    };
    const opened = () => {
      const encoded = Schema.encodeSync(EnvironmentHelloSchema)(hello);
      socket.send(JSON.stringify(encoded));
    };
    const received = (event: MessageEvent) => {
      messagePipeline = messagePipeline.then(() => handleMessage(event));
      void messagePipeline.catch(fail);
    };
    const handleMessage = async (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        throw environmentResponseError("WebSocket");
      }

      const byteLimit =
        negotiated?.limits.maxWebSocketResponseBytes ??
        hello.receiveLimits.maxWebSocketResponseBytes;
      if (new TextEncoder().encode(event.data).byteLength > byteLimit) {
        throw environmentResponseError("WebSocket");
      }

      const parsed: unknown = JSON.parse(event.data);
      if (!active) {
        const result = Schema.decodeUnknownSync(EnvironmentHelloResult)(parsed);
        if (result._tag === "HelloRejected") {
          throw new EnvironmentHelloRejected({ failure: result.failure });
        }
        assertNegotiatedResult(discovery, hello, result);
        active = true;
        negotiated = result;
        supportsEnvironmentEvents = result.capabilities.some(
          (capability) => capability.name === "environment-events",
        );
        supportsResnapshot = result.capabilities.some(
          (capability) => capability.name === "sequence-resnapshot",
        );
        currentSequence = supportsResnapshot
          ? (hello.lastObservedSequence ?? result.currentSequence)
          : result.currentSequence;
        clearTimeout(timeout);
        resolveConnection({
          close: () => fail(environmentResponseError("WebSocket")),
          currentSequence: () => currentSequence,
          discovery,
          negotiated: result,
          waitForSequence,
        });
        return;
      }

      const message = Schema.decodeUnknownSync(EnvironmentServerMessage)(
        parsed,
      );
      if (message._tag === "EnvironmentChanged") {
        if (!supportsEnvironmentEvents) {
          throw environmentResponseError("WebSocket");
        }
        const advanced = advanceEnvironmentSequence(
          currentSequence,
          message.sequence,
        );
        if (advanced._tag === "SequenceAccepted") {
          currentSequence = advanced.sequence;
          resolveWaiters(sequenceWaiters, currentSequence);
        } else if (advanced._tag === "ResnapshotRequired") {
          await recoverSnapshot(message.sequence);
        }
        return;
      }
      if (message._tag === "ResnapshotRequired") {
        if (!supportsResnapshot) {
          throw environmentResponseError("WebSocket");
        }
        await recoverSnapshot(message.currentSequence);
        return;
      }
      throw environmentResponseError("WebSocket");
    };
    const waitForSequence = (sequence: number) => {
      if (terminalFailure !== undefined) {
        return Promise.reject(terminalFailure);
      }
      if (currentSequence >= sequence) {
        return Promise.resolve(currentSequence);
      }
      return new Promise<number>((resolve, reject) => {
        sequenceWaiters.add({ reject, resolve, sequence });
      });
    };
    const recoverSnapshot = (minimumSequence: number) => {
      const snapshotLimit = Math.min(
        negotiated?.limits.maxHttpResponseBytes ??
          discovery.limits.maxHttpResponseBytes,
        hello.receiveLimits.maxHttpResponseBytes,
      );
      recovery ??= fetchEnvironmentSnapshotWithinLimit(
        origin,
        discovery,
        snapshotLimit,
        signal,
      )
        .then((snapshot) => {
          if (snapshot.sequence < minimumSequence) {
            throw environmentResponseError("Snapshot");
          }
          currentSequence = snapshot.sequence;
          const applied: typeof SnapshotApplied.Type = {
            _tag: "SnapshotApplied",
            sequence: snapshot.sequence,
          };
          socket.send(
            JSON.stringify(Schema.encodeSync(SnapshotApplied)(applied)),
          );
          resolveWaiters(sequenceWaiters, currentSequence);
        })
        .finally(() => {
          recovery = undefined;
        });
      return recovery;
    };
    const failed = () => fail(environmentResponseError("WebSocket"));
    const aborted = () =>
      fail(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const timeout = setTimeout(
      failed,
      discovery.limits.helloTimeoutMilliseconds,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("message", received);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", failed);
      signal?.removeEventListener("abort", aborted);
    };

    socket.addEventListener("open", opened);
    socket.addEventListener("message", received);
    socket.addEventListener("error", failed);
    socket.addEventListener("close", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) {
      aborted();
    }
  });
}

interface SequenceWaiter {
  readonly reject: (error: unknown) => void;
  readonly resolve: (sequence: number) => void;
  readonly sequence: number;
}

function resolveWaiters(waiters: Set<SequenceWaiter>, sequence: number) {
  for (const waiter of waiters) {
    if (waiter.sequence <= sequence) {
      waiter.resolve(sequence);
      waiters.delete(waiter);
    }
  }
}

function assertNegotiatedResult(
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  result: NegotiatedEnvironment,
) {
  const expected = negotiateEnvironmentHello(
    discovery,
    hello,
    result.currentSequence,
  );
  if (
    expected._tag !== "HelloAccepted" ||
    JSON.stringify(Schema.encodeSync(EnvironmentHelloResult)(expected)) !==
      JSON.stringify(Schema.encodeSync(EnvironmentHelloResult)(result))
  ) {
    throw environmentResponseError("WebSocket");
  }
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
