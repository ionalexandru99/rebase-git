import {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefs,
  RepositoryRefsHttpApi,
  type RepositoryRefsHttpFailure,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";
import {
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";

export function readRepositoryRefsEffect(
  origin: string,
  credential: EnvironmentCredential,
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

export function checkoutRepositoryRefEffect(
  origin: string,
  credential: EnvironmentCredential,
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
  credential: EnvironmentCredential,
  successSchema: S,
  failureSchema: F,
  body?: string,
) {
  return requestEnvironmentJson(
    url,
    method,
    credential,
    successSchema,
    failureSchema,
    body,
  ).pipe(
    Effect.mapError((error) =>
      error._tag === "EnvironmentHttpRejected"
        ? new RepositoryRefsRejected({
            failure: error.failure,
            status: error.status,
          })
        : new RepositoryRefsResponseError(),
    ),
  );
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
