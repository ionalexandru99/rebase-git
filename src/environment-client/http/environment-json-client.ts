import { Effect, type Schema } from "effect";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentJson } from "#environment-client/http/environment-http-json";
import type {
  EnvironmentHttpRejected,
  EnvironmentHttpResponseError,
} from "#environment-client/http/environment-http-json.contract";
import type { EnvironmentRequestClient } from "#environment-client/http/environment-request-client.contract";

export function createEnvironmentRequestClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): EnvironmentRequestClient {
  return (failure, errors) =>
    createEnvironmentJsonClient(origin, credential, failure, errors);
}

export function createEnvironmentJsonClient<
  F extends Schema.ConstraintDecoder<unknown, never>,
  E,
>(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
  failure: F,
  errors: {
    readonly disconnected: () => E;
    readonly response: (
      error: EnvironmentHttpResponseError | EnvironmentHttpRejected<F["Type"]>,
    ) => E;
  },
) {
  return <S extends Schema.ConstraintDecoder<unknown, never>>(
    endpoint: { readonly path: string; readonly success: S },
    command: unknown,
  ) =>
    Effect.suspend(() => {
      const authorized = credential();
      if (authorized === undefined) return Effect.fail(errors.disconnected());
      return requestEnvironmentJson(
        new URL(endpoint.path, origin),
        "POST",
        authorized,
        endpoint.success,
        failure,
        JSON.stringify(command),
      ).pipe(Effect.mapError(errors.response));
    });
}
