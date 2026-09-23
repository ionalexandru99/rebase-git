import type { ServerResponse } from "node:http";
import {
  EnvironmentAuthorizationFailure,
  EnvironmentHttpFailure,
} from "@rebase/contracts";
import { Schema } from "effect";
import { authorizationFailureStatus } from "#server/adapters/environment-transport/environment-request-authorization";
import type { EnvironmentHttpBodyError } from "#server/adapters/environment-transport/http/environment-http-request-body.contract";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.contract";

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

export function writeEnvironmentHttpError(
  response: ServerResponse,
  error:
    | EnvironmentAuthorizationError
    | EnvironmentHttpBodyError
    | EnvironmentStorageError,
) {
  if (response.writableEnded) {
    return;
  }
  if (error._tag === "EnvironmentAuthorizationError") {
    writeJson(
      response,
      authorizationFailureStatus(error.failure),
      EnvironmentAuthorizationFailure,
      error.failure,
    );
    return;
  }
  if (error._tag === "EnvironmentHttpBodyError") {
    writeJson(
      response,
      error.failure._tag === "PayloadTooLarge" ? 413 : 400,
      EnvironmentHttpFailure,
      error.failure,
    );
    return;
  }
  response.writeHead(500).end();
}
