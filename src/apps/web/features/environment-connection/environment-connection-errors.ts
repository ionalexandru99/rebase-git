import type {
  EnvironmentAuthorizationHttpFailure,
  EnvironmentTransportFailure,
} from "@rebase/contracts";
import { Data } from "effect";

export class EnvironmentResponseError extends Data.TaggedError(
  "EnvironmentResponseError",
)<{
  readonly responseTag:
    | "Authorization"
    | "Discovery"
    | "Snapshot"
    | "WebSocket";
}> {}

export class EnvironmentHelloRejected extends Data.TaggedError(
  "EnvironmentHelloRejected",
)<{
  readonly failure: EnvironmentTransportFailure;
}> {}

export class EnvironmentAuthorizationRejected extends Data.TaggedError(
  "EnvironmentAuthorizationRejected",
)<{
  readonly failure: EnvironmentAuthorizationHttpFailure;
  readonly status: number;
}> {}

export type EnvironmentConnectionFailure =
  | EnvironmentAuthorizationRejected
  | EnvironmentHelloRejected
  | EnvironmentResponseError;

export function environmentResponseError(
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return new EnvironmentResponseError({ responseTag });
}
