import { RepositoryRefs } from "@rebase/contracts";
import { Effect, Option, Schema, Stream } from "effect";
import {
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";
import type { RepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport.contract";
import { hasEnvironmentCapability } from "#web/platform/environment/environment-capabilities";
import type { NegotiatedEnvironmentRpc } from "#web/platform/environment/environment-protocol.contract";
import { rpcJsonReassembler } from "#web/platform/environment/rpc/environment-rpc-json";
import { createEnvironmentRequestId } from "#web/platform/environment/websocket/environment-request-id";

export function createRepositoryRefsRpc(
  connection: NegotiatedEnvironmentRpc,
): RepositoryRefsTransport {
  const client = connection.rpc;
  const enabled =
    hasEnvironmentCapability(connection.negotiated, "json-fragmentation") &&
    hasEnvironmentCapability(connection.negotiated, "repository-refs");
  return {
    read: (repositoryId) =>
      Effect.gen(function* () {
        if (!enabled) return yield* new RepositoryRefsResponseError();
        const requestId = createEnvironmentRequestId();
        const accept = rpcJsonReassembler(requestId);
        const response = yield* client
          .ReadRefs(
            { _tag: "ReadRepositoryRefs", repositoryId, requestId },
            { streamBufferSize: 1 },
          )
          .pipe(
            Stream.mapError((error) =>
              error._tag === "RpcClientError"
                ? new RepositoryRefsResponseError()
                : new RepositoryRefsRejected({
                    failure: error,
                    status:
                      error._tag === "CapabilityDenied"
                        ? 403
                        : error._tag === "RepositoryMissing"
                          ? 404
                          : 422,
                  }),
            ),
            Stream.mapEffect((frame) =>
              accept(frame).pipe(
                Effect.mapError(() => new RepositoryRefsResponseError()),
              ),
            ),
            Stream.filter((bytes): bytes is Uint8Array => bytes !== undefined),
            Stream.runHead,
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () => Effect.fail(new RepositoryRefsResponseError()),
            }),
          );
        if (Option.isNone(response))
          return yield* new RepositoryRefsResponseError();
        return yield* Effect.try({
          try: () => {
            const result = Schema.decodeUnknownSync(RepositoryRefs)(
              JSON.parse(new TextDecoder().decode(response.value)),
            );
            if (result.repositoryId !== repositoryId)
              throw new Error("Repository identity mismatch");
            return result;
          },
          catch: () => new RepositoryRefsResponseError(),
        });
      }),
  };
}
