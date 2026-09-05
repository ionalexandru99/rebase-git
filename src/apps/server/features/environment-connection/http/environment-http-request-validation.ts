import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, Schema } from "effect";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";

export function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
) {
  if (request.method === method) return Effect.void;
  return Effect.sync(() =>
    response.writeHead(405, { allow: method }).end(),
  ).pipe(Effect.andThen(Effect.interrupt));
}

export function requireEmptyBody(body: Buffer) {
  return body.byteLength === 0 ? Effect.void : Effect.fail(invalidMessage());
}

export function decodeRequestBody<
  S extends Schema.ConstraintDecoder<unknown, never>,
>(schema: S, body: Buffer) {
  return Effect.try({
    try: () => JSON.parse(body.toString("utf8")) as unknown,
    catch: invalidMessage,
  }).pipe(Effect.flatMap((value) => decodeRequestValue(schema, value)));
}

export function decodeRequestValue<
  S extends Schema.ConstraintDecoder<unknown, never>,
>(schema: S, value: unknown) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema)(value, { onExcessProperty: "error" }),
    catch: invalidMessage,
  });
}

function invalidMessage() {
  return new EnvironmentHttpBodyError({ failure: { _tag: "InvalidMessage" } });
}
