import {
  currentClientReceiveLimits,
  EnvironmentAccessFailure,
  isRouteOk,
  type RouteSuccess,
} from "@rebase/contracts";
import { Schema } from "effect";
import {
  EnvironmentAccessDenied,
  EnvironmentHttpRejected,
  environmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import type {
  EnvironmentHttpRequestOptions,
  RequestableEnvironmentHttpRoute,
} from "#environment-client/http/environment-http-request.contract";
import { readBoundedEnvironmentResponseBody } from "#environment-client/http/environment-http-response-body";

export async function requestEnvironmentHttp<
  Route extends RequestableEnvironmentHttpRoute,
>(
  origin: string,
  route: Route,
  options: EnvironmentHttpRequestOptions<Route>,
): Promise<RouteSuccess<Route>> {
  const responseError = () => environmentResponseError(route.path);
  const request = await attempt(
    async () => buildRequest(origin, route, options),
    responseError,
  );
  const response = await attempt(
    () =>
      fetch(request.url, {
        ...request.init,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    responseError,
  );
  const body = await attempt(
    async () =>
      JSON.parse(
        await readBoundedEnvironmentResponseBody(
          response,
          options.maxResponseBytes ??
            currentClientReceiveLimits.maxHttpResponseBytes,
        ),
      ) as unknown,
    responseError,
  );
  if (response.status !== 200)
    throw new EnvironmentAccessDenied({
      failure: await decodeBody(EnvironmentAccessFailure, body, responseError),
      status: response.status,
    });
  const result = await decodeBody(route.response, body, responseError);
  if (isRouteOk(result)) return result.value;
  throw new EnvironmentHttpRejected({ failure: result.failure });
}

async function attempt<A>(
  run: () => Promise<A>,
  onError: () => Error,
): Promise<A> {
  try {
    return await run();
  } catch {
    throw onError();
  }
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

function decodeBody<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  body: unknown,
  onError: () => Error,
) {
  return attempt(async () => Schema.decodeUnknownSync(schema)(body), onError);
}
