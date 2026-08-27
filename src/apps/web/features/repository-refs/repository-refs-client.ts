import {
  CheckoutRepositoryRef,
  currentClientReceiveLimits,
  RepositoryCheckedOut,
  RepositoryRefs,
  RepositoryRefsHttpApi,
  type RepositoryRefsHttpFailure,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { readBoundedEnvironmentResponseBody } from "#web/features/environment-connection/http/environment-http-response-body";
import {
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";

export function readRepositoryRefs(
  origin: string,
  credential: string,
  repositoryId: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    readRepositoryRefsEffect(origin, credential, repositoryId),
    signal === undefined ? undefined : { signal },
  );
}

export function readRepositoryRefsEffect(
  origin: string,
  credential: string,
  repositoryId: string,
) {
  const url = new URL(RepositoryRefsHttpApi.read.path, normalizeOrigin(origin));
  url.searchParams.set("repositoryId", repositoryId);
  return requestRepositoryRefs(
    url,
    RepositoryRefsHttpApi.read.method,
    credential,
    RepositoryRefs,
    RepositoryRefsHttpApi.read.failure,
  );
}

export function checkoutRepositoryRef(
  origin: string,
  credential: string,
  command: {
    readonly repositoryId: string;
    readonly target: RepositoryRefTarget;
    readonly worktreePath: string;
  },
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    checkoutRepositoryRefEffect(origin, credential, command),
    signal === undefined ? undefined : { signal },
  );
}

export function checkoutRepositoryRefEffect(
  origin: string,
  credential: string,
  command: {
    readonly repositoryId: string;
    readonly target: RepositoryRefTarget;
    readonly worktreePath: string;
  },
) {
  return requestRepositoryRefs(
    new URL(RepositoryRefsHttpApi.checkout.path, normalizeOrigin(origin)),
    RepositoryRefsHttpApi.checkout.method,
    credential,
    RepositoryCheckedOut,
    RepositoryRefsHttpApi.checkout.failure,
    JSON.stringify(Schema.encodeSync(CheckoutRepositoryRef)(command)),
  );
}

function requestRepositoryRefs<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<RepositoryRefsHttpFailure, never>,
>(
  url: URL,
  method: string,
  credential: string,
  successSchema: S,
  failureSchema: F,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          ...(body === undefined ? {} : { body }),
          headers: {
            authorization: `Bearer ${credential}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          method,
          signal,
        }),
      catch: () => new RepositoryRefsResponseError(),
    });
    return yield* decodeResponse(response, successSchema, failureSchema);
  });
}

function decodeResponse<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<RepositoryRefsHttpFailure, never>,
>(response: Response, successSchema: S, failureSchema: F) {
  return Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* readBoundedEnvironmentResponseBody(
        response,
        currentClientReceiveLimits.maxHttpResponseBytes,
      ).pipe(Effect.mapError(() => new RepositoryRefsResponseError()));
      const json = yield* Effect.try({
        try: () => JSON.parse(encoded) as unknown,
        catch: () => new RepositoryRefsResponseError(),
      });
      if (!response.ok) {
        const failure = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(failureSchema)(json),
          catch: () => new RepositoryRefsResponseError(),
        });
        return yield* Effect.fail(
          new RepositoryRefsRejected({ failure, status: response.status }),
        );
      }
      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(successSchema)(json),
        catch: () => new RepositoryRefsResponseError(),
      });
    }),
  );
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
