import { currentClientReceiveLimits } from "@rebase/contracts";
import { Effect, Schema } from "effect";
import {
  EnvironmentHttpRejected,
  type EnvironmentResponseError,
  environmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import type {
  EnvironmentHttpRequestOptions,
  RequestableEnvironmentHttpRoute,
} from "#environment-client/http/environment-http-request.contract";
import { readBoundedEnvironmentResponseBody } from "#environment-client/http/environment-http-response-body";

export function requestEnvironmentHttp<
  Route extends RequestableEnvironmentHttpRoute,
>(
  origin: string,
  route: Route,
  options: EnvironmentHttpRequestOptions<Route>,
): Effect.Effect<
  Route["success"]["Type"],
  EnvironmentResponseError | EnvironmentHttpRejected<Route["failure"]["Type"]>
> {
  const responseError = () => environmentResponseError(route.path);
  return Effect.gen(function* () {
    const request = yield* Effect.try({
      try: () => buildRequest(origin, route, options),
      catch: responseError,
    });
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(request.url, {
          ...request.init,
          signal: joinSignals(signal, options.signal),
        }),
      catch: responseError,
    });
    const body = yield* readJsonBody(
      response,
      options.maxResponseBytes ??
        currentClientReceiveLimits.maxHttpResponseBytes,
      responseError,
    );
    if (response.status === route.successStatus) {
      return yield* decodeBody(route.success, body, responseError);
    }
    if (!route.failureStatuses.some((status) => status === response.status)) {
      return yield* responseError();
    }
    const failure = yield* decodeBody(route.failure, body, responseError);
    return yield* new EnvironmentHttpRejected({
      failure,
      status: response.status,
    });
  });
}

function buildRequest<Route extends RequestableEnvironmentHttpRoute>(
  origin: string,
  route: Route,
  options: EnvironmentHttpRequestOptions<Route>,
) {
  const authentication = credentialRequest(options.credential);
  const body =
    route.request === undefined
      ? undefined
      : JSON.stringify(
          Schema.encodeUnknownSync(route.request)(options.command),
        );
  return {
    url: new URL(route.path, origin),
    init: {
      credentials: authentication.credentials,
      headers: {
        ...authentication.headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method: route.method,
      ...(body === undefined ? {} : { body }),
    } satisfies RequestInit,
  };
}

function credentialRequest(credential: EnvironmentCredential | undefined): {
  readonly credentials: RequestCredentials;
  readonly headers: Record<string, string>;
} {
  if (credential === undefined) return { credentials: "omit", headers: {} };
  return credential.type === "browser-session"
    ? { credentials: "same-origin", headers: {} }
    : {
        credentials: "omit",
        headers: { authorization: `Bearer ${credential.value}` },
      };
}

function joinSignals(effectSignal: AbortSignal, external?: AbortSignal) {
  return external === undefined
    ? effectSignal
    : AbortSignal.any([effectSignal, external]);
}

function readJsonBody(
  response: Response,
  byteLimit: number,
  onError: () => EnvironmentResponseError,
) {
  return Effect.scoped(
    readBoundedEnvironmentResponseBody(response, byteLimit).pipe(
      Effect.mapError(onError),
      Effect.flatMap((encoded) =>
        Effect.try({
          try: () => JSON.parse(encoded) as unknown,
          catch: onError,
        }),
      ),
    ),
  );
}

function decodeBody<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  body: unknown,
  onError: () => EnvironmentResponseError,
) {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(body),
    catch: onError,
  });
}
