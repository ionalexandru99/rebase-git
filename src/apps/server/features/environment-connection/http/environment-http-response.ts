import type { ServerResponse } from "node:http";
import { Schema } from "effect";

export function writeJson<S extends Schema.ConstraintEncoder<unknown, never>>(
  response: ServerResponse,
  status: number,
  schema: S,
  value: S["Type"],
) {
  writeJsonValue(response, status, Schema.encodeSync(schema)(value));
}

export function writeJsonValue(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}
