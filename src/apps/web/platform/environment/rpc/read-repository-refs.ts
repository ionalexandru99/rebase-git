import {
  type EnvironmentRpcClient,
  RepositoryRefs,
  type RepositoryRefsFailed,
} from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  type EnvironmentResponseError,
  environmentResponseError,
} from "@rebase/environment-client";
import { Cause, Effect, Option, Schema, Stream } from "effect";
import { rpcJsonReassembler } from "#web/platform/environment/rpc/environment-rpc-json";
import { createEnvironmentRequestId } from "#web/platform/environment/websocket/environment-request-id";

export type RepositoryRefsReadFailure =
  | EnvironmentResponseError
  | EnvironmentHttpRejected<RepositoryRefsFailed["failure"]>;

type RefsRpc = Pick<EnvironmentRpcClient, "ReadRefs">;

export function readRepositoryRefs(
  rpc: RefsRpc,
  repositoryId: string,
  signal: AbortSignal,
): Promise<RepositoryRefs> {
  return Effect.runPromise(
    readRefsPayload(rpc, repositoryId).pipe(
      Effect.flatMap((bytes) => decodeRefs(bytes, repositoryId)),
      Effect.catchCause((cause) =>
        Effect.fail(Option.getOrElse(Cause.findErrorOption(cause), unanswered)),
      ),
    ),
    { signal },
  );
}

function readRefsPayload(rpc: RefsRpc, repositoryId: string) {
  const requestId = createEnvironmentRequestId();
  const accept = rpcJsonReassembler(requestId);
  return rpc
    .ReadRefs(
      { _tag: "ReadRepositoryRefs", repositoryId, requestId },
      { streamBufferSize: 1 },
    )
    .pipe(
      Stream.mapError(
        (error): RepositoryRefsReadFailure =>
          error._tag === "RpcClientError"
            ? unanswered()
            : new EnvironmentHttpRejected({ failure: error }),
      ),
      Stream.mapEffect((frame) =>
        accept(frame).pipe(Effect.mapError(unanswered)),
      ),
      Stream.filter((bytes): bytes is Uint8Array => bytes !== undefined),
      Stream.runHead,
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => Effect.fail(unanswered()),
      }),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(unanswered()),
          onSome: Effect.succeed,
        }),
      ),
    );
}

function decodeRefs(bytes: Uint8Array, repositoryId: string) {
  return Effect.try({
    try: () => {
      const refs = Schema.decodeUnknownSync(RepositoryRefs)(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (refs.repositoryId !== repositoryId)
        throw new Error("Repository identity mismatch");
      return refs;
    },
    catch: unanswered,
  });
}

function unanswered() {
  return environmentResponseError("WebSocket");
}
