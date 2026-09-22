import type { IncomingMessage, ServerResponse } from "node:http";
import type { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";

export type EnvironmentHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
) => Effect.Effect<
  boolean,
  | EnvironmentAuthorizationError
  | EnvironmentHttpBodyError
  | EnvironmentStorageError
>;
