import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EnvironmentAuthorizationHttpApi,
  EnvironmentBrowserSession,
  ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { writeBrowserSessionCookie } from "#server/features/environment-authorization/http/environment-session-cookie";
import {
  readRequestCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import {
  decodeRequestBody,
  requireEmptyBody,
} from "#server/features/environment-connection/http/environment-http-request-validation";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToBrowserSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
) {
  return Effect.gen(function* () {
    if (request.method === "POST") {
      yield* validateRequestOrigin(request, true);
      const paired = yield* authorization.exchangePairing(
        yield* decodeRequestBody(ExchangeEnvironmentPairing, body),
      );
      writeBrowserSessionCookie(request, response, paired.credential);
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.createBrowserSession.successStatus,
        EnvironmentBrowserSession,
        { authorization: paired.authorization },
      );
      return;
    }
    if (request.method === "GET") {
      yield* requireEmptyBody(body);
      yield* validateRequestOrigin(request, false);
      const device = yield* authorization.authorize(
        readRequestCredential(request),
        "environment.read",
      );
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.readBrowserSession.successStatus,
        EnvironmentBrowserSession,
        { authorization: device },
      );
      return;
    }
    response.writeHead(405, { allow: "GET, POST" }).end();
  });
}
